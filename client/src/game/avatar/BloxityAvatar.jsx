import { useFrame, useLoader } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box3, MeshLambertMaterial, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { assetUrls, baseBodyUrl, isRealId, PART_SLOTS, skinCompositeUrl, skinIdOrDefault, WORN_SLOTS } from '../../bloxity/avatarAssets'
import { loadCharacterGLB, loadOBJ, loadPartGLB, loadTexture } from '../../bloxity/avatarLoader'
import { getSDK, safeCall } from '../../bloxity/sdk'
import {
  animateRig,
  applyPart,
  applyProportions,
  applySkin,
  attachAccessory,
  attachToCharacter,
  collectRig,
  disposeMergedBody,
  mergeBody,
  placeAtBone,
  placeFollowers,
  placeHand,
  restInverses,
} from './avatarRig'

/**
 * A Bloxity avatar wearing `equipped` with `proportions`, assembled at runtime: yours,
 * or another player's from what the server says they wear (bots wear the base body).
 *
 * `player.glb` (27 KB) is the base humanoid: six skinned parts on one skeleton. Per
 * equipped slot, body parts swap the matching part's geometry, hats / back items /
 * accessories attach to bones, and the skin (with shirt, pants and face drawn on by
 * Boxity) is one texture. The six parts are then merged into one skinned mesh, so a
 * character is one draw call plus one per worn item. Anything that fails to load falls
 * back to the base body; a player's own uploaded character (`characterId`) is used
 * when the SDK can describe it.
 *
 * The body is posed every frame from `motionRef.current` (avatarPose.js), `handRef`
 * is moved onto the right palm (for the held item) and `backRef` onto the neck (for
 * the cape). The rig faces +Z; the parent turns it to face the game's way.
 * While `activeRef.current` is false (not on screen) the pose isn't updated at all.
 */
export default function BloxityAvatar({ equipped, proportions, motionRef, handRef, offHandRef, backRef, activeRef, onReady, local = false, targetHeight = 1.8 }) {
  const { scene: baseScene } = useLoader(GLTFLoader, baseBodyUrl())
  const [assembled, setAssembled] = useState(false)
  const bodyRef = useRef(null)
  const custom = useCustomCharacter(equipped, local)

  // The loader caches one scene: each avatar gets its own clone with a working skeleton.
  const character = useMemo(() => cloneSkeleton(custom?.scene ?? baseScene), [custom, baseScene])
  const baseRest = useMemo(() => restInverses(baseScene), [baseScene])

  const rig = useMemo(() => {
    const collected = collectRig(character)
    for (const mesh of collected.skinnedMeshes) {
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.material = new MeshLambertMaterial({ color: 0xffffff, map: custom ? (mesh.material?.map ?? null) : null })
    }
    return collected
  }, [character, custom])

  // Bloxity authors the rig ~6.4 units tall, feet at y 0: scaled to the game's 1.8 m.
  const fit = useMemo(() => {
    const box = new Box3().setFromObject(baseScene)
    const size = box.getSize(new Vector3())
    if (!Number.isFinite(size.y) || size.y <= 0) return { scale: 1, footOffset: 0 }
    const scale = targetHeight / size.y
    return { scale, footOffset: -box.min.y * scale }
  }, [baseScene, targetHeight])

  useEffect(() => {
    let cancelled = false
    const holder = bodyRef
    const attached = []
    const jobs = []
    if (custom) {
      if (custom.info?.textureUrl) jobs.push(loadTexture(custom.info.textureUrl).then((texture) => ({ kind: 'characterTexture', texture })))
    } else {
      const compositeUrl = skinCompositeUrl(equipped)
      const plainSkinUrl = assetUrls.skinTexture(skinIdOrDefault(equipped?.skinId))
      jobs.push(
        (compositeUrl ? loadTexture(compositeUrl) : Promise.resolve(null))
          .then((texture) => texture || loadTexture(plainSkinUrl))
          .then((texture) => ({ kind: 'skin', texture })),
      )
      for (const [slot, cfg] of Object.entries(PART_SLOTS)) {
        const id = equipped?.[cfg.idKey]
        if (!isRealId(id)) {
          jobs.push(Promise.resolve({ kind: 'part', slot, scene: null }))
          continue
        }
        jobs.push(loadPartGLB(assetUrls.part(slot, id)).then((scene) => ({ kind: 'part', slot, scene })))
      }
    }
    for (const [slot, cfg] of Object.entries(WORN_SLOTS)) {
      const id = equipped?.[cfg.idKey]
      if (!isRealId(id)) continue
      jobs.push(Promise.all([loadOBJ(cfg.mesh(id)), loadTexture(cfg.texture(id))]).then(([object, texture]) => ({ kind: 'accessory', accessory: slot, object, texture })))
    }
    const accessoryMatrix = custom ? characterAccessoryMatrix() : null

    Promise.all(jobs)
      .then((results) => {
        if (cancelled) return
        for (const result of results) {
          try {
            if (result.kind === 'characterTexture') {
              if (result.texture) for (const mesh of rig.skinnedMeshes) if (!mesh.material.map) mesh.material.map = result.texture
              for (const mesh of rig.skinnedMeshes) mesh.material.needsUpdate = true
            } else if (result.kind === 'skin') {
              applySkin(rig, result.texture)
            } else if (result.kind === 'part') {
              applyPart(rig, result.slot, result.scene)
            } else if (result.kind === 'accessory' && result.object) {
              if (result.texture) {
                result.object.traverse((child) => {
                  if (child.isMesh) child.material = new MeshLambertMaterial({ map: result.texture })
                })
              }
              const added = custom
                ? attachToCharacter(rig, result.accessory, result.object, custom.info, baseRest, accessoryMatrix)
                : attachAccessory(rig, result.accessory, result.object)
              attached.push(...added)
            }
          } catch (err) {
            console.warn(`[bloxity] failed to apply ${result.kind}`, err)
          }
        }
        // Bones are uploaded to the GPU only on frames the body is posed (the pose is
        // otherwise exactly last frame's): saves a texture upload per avatar per frame.
        if (rig.skeleton && !rig.skeleton.lazyUpdate) {
          const skeleton = rig.skeleton
          const update = skeleton.update.bind(skeleton)
          let uploaded = false
          skeleton.update = () => {
            if (uploaded && activeRef?.current === false) return
            uploaded = true
            update()
          }
          skeleton.lazyUpdate = true
        }
        if (!custom) {
          try {
            disposeMergedBody(holder.current)
            holder.current = mergeBody(rig)
          } catch (err) {
            console.warn('[bloxity] could not merge the body; drawing its parts', err)
            for (const mesh of rig.skinnedMeshes) {
              mesh.visible = true
              mesh.matrixWorldAutoUpdate = true
            }
          }
        }
        setAssembled(true)
      })
      .catch((err) => {
        console.warn('[bloxity] avatar assembly failed; showing base body', err)
        if (!cancelled) setAssembled(true)
      })

    return () => {
      cancelled = true
      rig.followers.length = 0
      for (const object of attached) {
        object.parent?.remove(object)
        object.traverse((child) => {
          child.geometry?.dispose()
          if (child.isMesh) child.material?.dispose()
        })
      }
    }
  }, [rig, equipped, custom, baseRest, activeRef])

  // Frees what this avatar made when it goes (players come and go every round).
  useEffect(() => {
    const holder = bodyRef
    return () => {
      disposeMergedBody(holder.current)
      holder.current = null
      for (const mesh of rig.skinnedMeshes) mesh.material.dispose()
      for (const geometry of Object.values(rig.originalGeometries)) geometry.dispose()
    }
  }, [rig])

  const proportionsRef = useRef(proportions)
  useEffect(() => {
    proportionsRef.current = proportions
  }, [proportions])

  useFrame(() => {
    // Off screen, hidden, or skipping this frame (far away): no posing at all.
    if (!assembled || activeRef?.current === false) return
    try {
      // Proportions reset every bone to its rest pose; the pose rotates on top.
      applyProportions(rig, custom ? null : proportionsRef.current)
      if (motionRef?.current) animateRig(rig, motionRef.current, 1 / fit.scale)
      placeFollowers(rig)
      if (handRef?.current) placeHand(rig, handRef.current)
      if (offHandRef?.current) placeHand(rig, offHandRef.current, true)
      // The cape hangs from the base of the head (Neck1 sits at the shoulders).
      if (backRef?.current) placeAtBone(rig, 'Neck1', backRef.current) || placeAtBone(rig, 'Spine2', backRef.current)
    } catch {
      // A malformed payload must not kill the render loop.
    }
  })

  useEffect(() => {
    if (assembled) onReady?.()
  }, [assembled, onReady])

  return (
    <group scale={fit.scale} position={[0, fit.footOffset, 0]} visible={assembled}>
      <primitive object={character} />
    </group>
  )
}

/** The SDK's characterAccessoryMatrix(character, bone), or null on an SDK without it. */
function characterAccessoryMatrix() {
  const avatar = getSDK()?.avatar
  if (typeof avatar?.characterAccessoryMatrix !== 'function') return null
  return (character, bone) => safeCall(avatar.characterAccessoryMatrix.bind(avatar), character, bone) ?? null
}

/**
 * The uploaded character `equipped.characterId` names, loaded: { info, scene }, or null
 * for the regular avatar. Yours comes from avatar.getCharacter(), anyone else's from
 * avatar.getCharacterFor(equipped).
 */
function useCustomCharacter(equipped, local) {
  const characterId = isRealId(equipped?.characterId) ? String(equipped.characterId) : null
  const [loaded, setLoaded] = useState(null)
  const equippedRef = useRef(equipped)
  useEffect(() => {
    equippedRef.current = equipped
  }, [equipped])
  useEffect(() => {
    if (!characterId) return undefined
    let cancelled = false
    const avatar = getSDK()?.avatar
    const describe = local ? avatar?.getCharacter : avatar?.getCharacterFor
    Promise.resolve(typeof describe === 'function' ? describe.call(avatar, equippedRef.current) : null)
      .then((info) => (info?.glbUrl ? loadCharacterGLB(info.glbUrl).then((scene) => (scene ? { id: characterId, info, scene } : null)) : null))
      .catch(() => null)
      .then((result) => {
        if (!cancelled) setLoaded(result)
      })
    return () => {
      cancelled = true
    }
  }, [characterId, local])
  return characterId && loaded?.id === characterId ? loaded : null
}
