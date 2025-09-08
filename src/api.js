export { thankUser as thank } from './thank.js';
export { gblockUser as gblock } from './gblock.js';
export { blockUser as block } from './block.js';
export { deletePage as delete } from './delete.js';
export { movePage as move } from './move.js';
export { rollbackPage as rollback } from './rollback.js';
export { undoPage as undo } from './undo.js';
export { revertFile as filerevert } from './filerevert.js';
export const allowedAction = new Set(['thank', 'gblock', 'block', 'blocknotalk', 'delete', 'move', 'rollback', 'undo', 'file']);
export const commentAction = new Set(['gblock', 'block', 'blocknotalk', 'delete', 'move', 'rollback', 'undo', 'file']);
export const autocommentAction = new Set(['rollback', 'undo']);
export const expiryAction = new Set(['gblock', 'block', 'blocknotalk']);
export const thankAction = new Set(['rev', 'log']);
export const metaAction = new Set(['gblock']);
export const commentDropdown = new Map([
	['gblock', 'globalblocking-block-reason-dropdown'],
	['block', 'ipbreason-dropdown'],
	['blocknotalk', 'ipbreason-dropdown'],
	['delete', 'deletereason-dropdown']
]);