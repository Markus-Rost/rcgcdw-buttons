export { blockUser as block } from './block.js';
export { deletePage as delete } from './delete.js';
export { movePage as move } from './move.js';
export { rollbackPage as rollback } from './rollback.js';
export { undoPage as undo } from './undo.js';
export { revertFile as filerevert } from './filerevert.js';
export const allowedAction = ['block', 'delete', 'move', 'rollback', 'undo', 'file'];
export const autocommentAction = ['rollback', 'undo'];
export const expiryAction = ['block'];