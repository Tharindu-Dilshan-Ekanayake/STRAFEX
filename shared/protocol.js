import { ITEMS } from './balance.js'

/**
 * The compact codes snapshots use (shared by the host and every client): an animation
 * index and an item index per entity. Kept apart from host.js so a client can read
 * snapshots without bundling the whole host.
 */
export const ANIMS = ['idle', 'walk', 'sprint', 'sneak', 'air', 'block']
export const ITEM_IDS = Object.keys(ITEMS)
