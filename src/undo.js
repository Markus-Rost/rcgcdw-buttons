import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {Context} context
 * @param {String} pageid
 * @param {String} undo
 * @param {String} [summary]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<Boolean>}
 */
export async function undoPage(context, pageid, undo, summary = '', forceRefresh = false) {
	let tokens = await getToken(context, 'csrf', forceRefresh);
	if ( !tokens ) return false;
	let formData = {
		action: 'edit',
		pageid, undo,
		token: tokens.csrftoken,
		assert: 'user', errorformat: 'plaintext',
		formatversion: 2, format: 'json'
	};
	if ( summary ) formData.summary = summary;
	return got.post( `${context.wiki}api.php`, {
		form: formData,
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || body?.edit?.result !== 'Success' ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh() ) {
					return undoPage(context, pageid, undo, summary, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return undoPage(context, pageid, undo, summary, true);
				}
				if ( body.errors.some( error => error.code === 'undofailure' ) ) {
				}
			}
			console.log( `- ${response.statusCode}: Error while undoing the edit: ${parseErrors(response)}` );
			return false;
		}
		console.log( `- Undid r${undo} on ${context.wiki}/wiki/${body.edit.title}` );
		return true;
	}, error => {
		console.log( `- Error while undoing the edit: ${error}` );
		return false;
	} );
}
