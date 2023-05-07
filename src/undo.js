import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {String} wiki
 * @param {Context} context
 * @param {String} pageid
 * @param {String} undo
 * @param {String} [summary]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<String>}
 */
export async function undoPage(wiki, context, pageid, undo, summary = '', forceRefresh = false) {
	let tokens = await getToken(wiki, context, 'csrf', forceRefresh);
	if ( !tokens ) return 'Error: I ran into an error while trying to undo the edit!';
	let formData = {
		action: 'edit', pageid, undo,
		token: tokens.csrftoken,
		assert: 'user', errorformat: 'plaintext',
		formatversion: 2, format: 'json'
	};
	if ( summary ) formData.summary = summary;
	return got.post( `${wiki}api.php`, {
		form: formData,
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || body?.edit?.result !== 'Success' ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
					return undoPage(wiki, context, pageid, undo, summary, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return undoPage(wiki, context, pageid, undo, summary, true);
				}
				if ( body.errors.some( error => error.code === 'undofailure' ) ) {
					return 'Error: The edit couldn\'t be undone due to conflicting intermediate edits!';
				}
				if ( body.errors.some( error => ['missingtitle', 'nosuchpageid', 'nosuchrevid'].includes( error.code ) ) ) {
					return 'Error: The page or revision doesn\'t exist anymore!';
				}
				if ( body.errors.some( error => ['permissiondenied', 'protectedpage', 'cascadeprotected', 'noedit', 'noimageredirect', 'spamdetected', 'abusefilter-warning', 'abusefilter-disallowed'].includes( error.code ) ) ) {
					return 'Error: You don\'t have the permission for this action!';
				}
				if ( body.errors.some( error => error.code === 'editconflict' ) ) {
					return 'Error: I ran into an edit conflict, please try again!';
				}
			}
			console.log( `- ${response.statusCode}: Error while undoing the edit: ${parseErrors(response)}` );
			return 'Error: I ran into an error while trying to undo the edit!';
		}
		console.log( `- Undid r${undo} on ${body.edit.title} of ${wiki}` );
		return 'Success: The edit has been undone!';
	}, error => {
		console.log( `- Error while undoing the edit: ${error}` );
		return 'Error: I ran into an error while trying to undo the edit!';
	} );
}
