import { got, RefreshTokenError, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {String} wiki
 * @param {Context} context
 * @param {String} pageid
 * @param {String} undo
 * @param {String} [summary]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<String>}
 * @throws {RefreshTokenError}
 */
export async function undoPage(wiki, context, pageid, undo, summary = '', forceRefresh = false) {
	let tokens = await getToken(wiki, context, 'csrf', forceRefresh);
	if ( !tokens ) return context.get('undo_error');
	let formData = {
		action: 'edit', pageid, undo,
		token: tokens.csrftoken,
		assert: 'user', errorlang: 'en',
		errorformat: 'plaintext',
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
				if ( body.errors.some( error => ['missingtitle', 'nosuchpageid', 'nosuchrevid'].includes( error.code ) ) ) {
					return context.get('error_missingtitle');
				}
				if ( body.errors.some( error => error.code === 'undofailure' ) ) {
					return context.get('undo_error_undofailure');
				}
				if ( body.errors.some( error => ['permissiondenied', 'protectedpage', 'cascadeprotected', 'noedit', 'noimageredirect', 'spamdetected', 'abusefilter-warning', 'abusefilter-disallowed'].includes( error.code ) ) ) {
					return context.get('error_permissiondenied');
				}
				if ( body.errors.some( error => error.code === 'editconflict' ) ) {
					return context.get('undo_error_editconflict');
				}
			}
			console.log( `- ${response.statusCode}: Error while undoing the edit on ${wiki}: ${parseErrors(response)}` );
			return context.get('undo_error');
		}
		if ( body.edit.nochange ) {
			return context.get('undo_error_nochange');
		}
		console.log( `${wiki} - ${context.userId} undid r${undo} on ${body.edit.title}` );
		return context.get('undo_success');
	}, error => {
		console.log( `- Error while undoing the edit on ${wiki}: ${error}` );
		return context.get('undo_error');
	} );
}
