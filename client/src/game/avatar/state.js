/**
 * Which characters (by entity id) are currently drawn as their Bloxity avatar, so the
 * blocky stand-in (Characters.jsx) skips them. Written by Avatars.jsx once an avatar has
 * loaded, cleared when it goes.
 */
export const avatarShown = new Set()
