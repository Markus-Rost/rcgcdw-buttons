import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {Context} context
 * @param {String} pageid
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<Boolean>}
 */
export async function revertFile(context, archivename, forceRefresh = false) {
	let tokens = await getToken(context, 'csrf', forceRefresh);
	if ( !tokens ) return false;
	var filename = archivename.split('!').slice(1).join('!');
	return got.post( `${context.wiki}api.php`, {
		form: {
			action: 'filerevert', comment: '',
			filename, archivename,
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
					return revertFile(context, archivename, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return revertFile(context, archivename, true);
				}
				if ( body.errors.some( error => error.code === 'filerevert-badversion' ) ) {
					return false;
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