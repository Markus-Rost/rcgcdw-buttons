import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {Context} context
 * @param {String} fromid
 * @param {String} to
 * @param {String} [reason]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<Boolean>}
 */
export async function movePage(context, fromid, to, reason = '', forceRefresh = false) {
	let tokens = await getToken(context, 'csrf', forceRefresh);
	if ( !tokens ) return false;
	return got.post( `${context.wiki}api.php`, {
		form: {
			action: 'move', fromid, to,
			reason, noredirect: true,
			token: tokens.csrftoken,
			assert: 'user', errorformat: 'plaintext',
			formatversion: 2, format: 'json'
		},
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.move?.to ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh() ) {
					return movePage(context, fromid, to, reason, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return movePage(context, fromid, to, reason, true);
				}
				if ( body.errors.some( error => error.code === 'selfmove' ) ) {
				}
			}
			console.log( `- ${response.statusCode}: Error while moving the page: ${parseErrors(response)}` );
			return false;
		}
		console.log( `- Moved ${body.move.from} to ${context.wiki}/wiki/${body.move.to}` );
		return true;
	}, error => {
		console.log( `- Error while moving the page: ${error}` );
		return false;
	} );
}