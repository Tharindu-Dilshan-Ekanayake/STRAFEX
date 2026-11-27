import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { CASES } from '@shared/balance'
import { LOBBY_TOP } from '@shared/maps'

import { useGame } from '../store/game'
import { runtime } from './runtime'
import { lobbyLayout } from './world'

/**
 * The lobby's set dressing: a toy-chest case floating over each case stall, signs over
 * the Duels arch, the portal, the training grounds, the parkour and the sky pads, the
 * game's title over the sword monument, the leaderboard on the market wall, and the
 * training dummies (they wobble when you hit them). Mounted only in the lobby.
 */

export const FONT = "'Silkscreen', system-ui, sans-serif"

function box(w, h, d, x, y, z, color) {
  const geo = new BoxGeometry(w, h, d)
  geo.translate(x, y, z)
  const c = new Color(color)
  const shade = [0.82, 0.72, 1, 0.55, 0.92, 0.7]
  const colors = []
  for (let f = 0; f < 6; f += 1) for (let v = 0; v < 4; v += 1) colors.push(c.r * shade[f], c.g * shade[f], c.b * shade[f])
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geo
}

/** A chunky toy chest in the case's colour. */
function caseGeometry(color) {
  const dark = new Color(color).multiplyScalar(0.7).getStyle()
  const parts = [
    box(1.5, 0.8, 0.95, 0, 0, 0, color),
    box(1.56, 0.38, 1.0, 0, 0.56, 0, dark),
    box(1.6, 0.12, 1.04, 0, 0.36, 0, '#ffffff'),
    box(0.22, 0.26, 0.08, 0, 0.3, -0.52, '#ffffff'),
    box(0.16, 0.16, 0.06, -0.38, 0.05, -0.49, '#ff5fd2'),
    box(0.16, 0.16, 0.06, 0.38, 0.05, -0.49, '#ff5fd2'),
  ]
  const geo = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return geo
}

/** A straw training dummy on a post: post, body, belt, head with a face, arms (one model). */
function dummyGeometry() {
  const parts = [
    box(0.16, 0.7, 0.16, 0, 0.35, 0, '#6d4a2a'),
    box(0.56, 0.72, 0.32, 0, 1.05, 0, '#d8b44a'),
    box(0.58, 0.12, 0.34, 0, 0.82, 0, '#c8352e'),
    box(0.44, 0.44, 0.44, 0, 1.64, 0, '#e8d8a8'),
    box(1.2, 0.16, 0.16, 0, 1.2, 0, '#b8932f'),
    box(0.3, 0.06, 0.02, 0, 1.68, -0.23, '#3a2a1a'),
  ]
  const geo = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return geo
}

function textCanvas(w, h, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  draw(canvas.getContext('2d'), w, h)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.generateMipmaps = false
  return tex
}

function outlined(ctx, text, x, y, size, fill, stroke = '#1b1430', maxWidth = Infinity) {
  ctx.font = `700 ${size}px ${FONT}`
  // Too wide for the canvas: shrink to fit.
  const w = ctx.measureText(text).width
  if (w > maxWidth) {
    size = Math.floor((size * maxWidth) / w)
    ctx.font = `700 ${size}px ${FONT}`
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(4, size / 6)
  ctx.strokeStyle = stroke
  ctx.lineJoin = 'round'
  ctx.strokeText(text, x, y)
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
}

function stationLabel(caseId) {
  const c = CASES[caseId]
  return textCanvas(256, 128, (ctx, w) => {
    outlined(ctx, c.name.toUpperCase(), w / 2, 34, 30, c.color)
    outlined(ctx, `$${c.price}`, w / 2, 76, 30, '#7cff6b')
    outlined(ctx, 'PRESS E', w / 2, 110, 20, '#ffffff')
  })
}

function signLabel(sign) {
  return textCanvas(512, 128, (ctx, w) => {
    outlined(ctx, sign.text, w / 2, 46, 52, sign.color, '#1b1430', w - 24)
    outlined(ctx, sign.sub || '', w / 2, 100, 22, '#ffffff', '#1b1430', w - 24)
  })
}

function titleLabel() {
  return textCanvas(512, 160, (ctx, w) => {
    outlined(ctx, 'STRAFEX', w / 2, 66, 84, '#ffb21a')
    outlined(ctx, 'COMPETITIVE BLOCK PVP', w / 2, 126, 26, '#cfe6ff')
  })
}

function drawBoard(ctx, w, h, boards) {
  ctx.fillStyle = '#1d1630'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#2b2147'
  ctx.fillRect(8, 8, w - 16, h - 16)
  outlined(ctx, 'TOP PLAYERS', w / 2, 30, 30, '#ffd23b')
  const cols = [
    { key: 'wins', label: 'WINS', x: 20, color: '#ffd23b' },
    { key: 'kills', label: 'KILLS', x: w / 2 + 6, color: '#ff6b6b' },
  ]
  for (const col of cols) {
    ctx.textAlign = 'left'
    ctx.font = `700 20px ${FONT}`
    ctx.fillStyle = col.color
    ctx.fillText(col.label, col.x, 66)
    const rows = boards?.[col.key] || []
    ctx.font = `400 17px ${FONT}`
    for (let i = 0; i < 8; i += 1) {
      const r = rows[i]
      const y = 92 + i * 20
      ctx.fillStyle = i === 0 ? '#ffe58a' : '#e8e4ff'
      ctx.textAlign = 'left'
      ctx.fillText(`${i + 1}. ${r ? String(r.name).slice(0, 13) : '---'}`, col.x, y)
      ctx.textAlign = 'right'
      ctx.fillText(r ? String(Math.floor(r.value)) : '', col.x + w / 2 - 34, y)
    }
  }
}

const dummyObj = new Object3D()

export default function LobbyProps() {
  const boards = useGame((s) => s.leaderboards)
  const layout = lobbyLayout()

  const scene = useMemo(() => {
    const group = new Group()
    const caseMat = new MeshBasicMaterial({ vertexColors: true })
    const cases = []
    const textures = []
    const sprite = (tex, w, h, x, y, z) => {
      textures.push(tex)
      const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
      s.scale.set(w, h, 1)
      s.position.set(x, y, z)
      group.add(s)
      return s
    }
    for (const st of layout.stations) {
      if (!st.id.startsWith('case:')) continue
      const caseId = st.id.slice(5)
      const mesh = new Mesh(caseGeometry(CASES[caseId].color), caseMat)
      mesh.position.set(st.x, st.y + 1.2, st.z)
      group.add(mesh)
      cases.push({ mesh, baseY: st.y + 1.2 })
      sprite(stationLabel(caseId), 3.2, 1.6, st.x, st.y + 5.8, st.z)
    }
    for (const sign of layout.signs) sprite(signLabel(sign), 8, 2, sign.x, sign.y, sign.z)
    const title = sprite(titleLabel(), 12, 3.75, layout.center.x + 0.5, LOBBY_TOP + 27, layout.center.z + 0.5)

    // The training dummies: one instanced model, wobbling when hit.
    const dummyGeo = dummyGeometry()
    const dummies = new InstancedMesh(dummyGeo, caseMat, Math.max(1, layout.dummies.length))
    dummies.count = layout.dummies.length
    group.add(dummies)

    const boardCanvas = document.createElement('canvas')
    boardCanvas.width = 512
    boardCanvas.height = 256
    const boardTex = new CanvasTexture(boardCanvas)
    boardTex.colorSpace = SRGBColorSpace
    boardTex.minFilter = LinearFilter
    boardTex.generateMipmaps = false
    textures.push(boardTex)
    const b = layout.board
    const board = new Mesh(new PlaneGeometry(b.w, b.h), new MeshBasicMaterial({ map: boardTex }))
    board.position.set(b.x, b.y, b.z)
    board.rotation.y = b.ry || 0
    group.add(board)
    return { group, cases, textures, boardCanvas, boardTex, board, caseMat, title, titleY: title.position.y, dummies, dummyGeo }
  }, [layout])

  useEffect(() => {
    const draw = () => {
      drawBoard(scene.boardCanvas.getContext('2d'), 512, 256, boards)
      scene.boardTex.needsUpdate = true
    }
    draw()
    // Redraw once the pixel font has loaded (canvas text doesn't wait for it).
    document.fonts?.load(`700 20px ${FONT}`).then(draw).catch(() => {})
  }, [boards, scene])

  useEffect(
    () => () => {
      for (const c of scene.cases) c.mesh.geometry.dispose()
      for (const t of scene.textures) t.dispose()
      scene.caseMat.dispose()
      scene.dummyGeo.dispose()
      scene.board.geometry.dispose()
      scene.board.material.dispose()
      scene.group.traverse((o) => o.isSprite && o.material.dispose())
    },
    [scene],
  )

  useFrame(() => {
    const now = performance.now()
    const t = now / 1000
    scene.cases.forEach((c, i) => {
      c.mesh.rotation.y = t * 0.8 + i
      c.mesh.position.y = c.baseY + Math.sin(t * 2 + i) * 0.15
    })
    // The title floats and gently breathes.
    scene.title.position.y = scene.titleY + Math.sin(t * 1.3) * 0.35
    const breathe = 1 + Math.sin(t * 2.6) * 0.025
    scene.title.scale.set(12 * breathe, 3.75 * breathe, 1)
    // Dummies rock back after a hit and settle.
    const list = layout.dummies
    for (let i = 0; i < list.length; i += 1) {
      const d = list[i]
      const since = (now - (runtime.dummyHits[i] || -1e9)) / 1000
      const wobble = since < 1.2 ? Math.sin(since * 18) * 0.35 * (1 - since / 1.2) : 0
      dummyObj.position.set(d.x, d.y - 1, d.z)
      dummyObj.rotation.set(wobble, 0, wobble * 0.4)
      dummyObj.updateMatrix()
      scene.dummies.setMatrixAt(i, dummyObj.matrix)
    }
    scene.dummies.instanceMatrix.needsUpdate = true
  })

  return <primitive object={scene.group} />
}
