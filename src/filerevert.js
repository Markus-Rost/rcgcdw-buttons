import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {Context} context
 * @param {String} timestamp
 * @param {String} filename
 * @param {String} [comment]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<Boolean>}
 */
export async function revertFile(context, timestamp, filename, comment = '', forceRefresh = false) {
	let tokens = await getToken(context, 'csrf', forceRefresh);
	if ( !tokens ) return false;
	return got.post( `${context.wiki}api.php`, {
		form: {
			action: 'filerevert', comment, filename,
			archivename: `${timestamp}!${filename}`,
			token: tokens.csrftoken,
			assert: 'user', errorformat: 'plaintext',
			formatversion: 2, format: 'json'
		},
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || body?.filerevert?.result !== 'Success' ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh() ) {
					return revertFile(context, timestamp, filename, comment, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return revertFile(context, timestamp, filename, comment, true);
				}
				if ( body.errors.some( error => error.code === 'filerevert-badversion' ) ) {
				}
			}
			console.log( `- ${response.statusCode}: Error while reverting the file: ${parseErrors(response)}` );
			return false;
		}
		console.log( `- Reverted ${context.wiki}/wiki/File:${filename}` );
		return true;
	}, error => {
		console.log( `- Error while reverting the file: ${error}` );
		return false;
	} );
}