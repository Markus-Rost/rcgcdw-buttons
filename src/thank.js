import { got, RefreshTokenError, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {String} wiki
 * @param {Context} context
 * @param {'rev'|'log'} actiontype
 * @param {String} actionid
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<String>}
 * @throws {RefreshTokenError}
 */
export async function thankUser(wiki, context, actiontype, actionid, forceRefresh = false) {
	let tokens = await getToken(wiki, context, 'csrf', forceRefresh);
	if ( !tokens ) return context.get('thank_error');
	let formData = {
		action: 'thank', [actiontype]: actionid,
		token: tokens.csrftoken,
		source: process.env.npm_package_name,
		assert: 'user', errorlang: 'en',
		errorformat: 'plaintext',
		formatversion: 2, format: 'json'
	};
	return got.post( `${wiki}api.php`, {
		form: formData,
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.result?.success ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
					return thankUser(wiki, context, actiontype, actionid, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return thankUser(wiki, context, actiontype, actionid, true);
				}
				if ( body.errors.some( error => error.code === 'badvalue' ) ) {
					return context.get('error_extension');
				}
				if ( body.errors.some( error => ['invalidrevision', 'thanks-error-invalid-log-id'].includes( error.code ) ) ) {
					return context.get('error_missingtitle');
				}
				if ( body.errors.some( error => error.code === 'invalidrecipient' ) ) {
					return context.get('thank_error_invalidrecipient');
				}
			}
			console.log( `- ${response.statusCode}: Error while thanking on ${wiki}: ${parseErrors(response)}` );
			return context.get('thank_error');
		}
		console.log( `${wiki} - ${context.userId} thanked User:${body.result.recipient}` );
		return context.get('thank_success');
	}, error => {
		console.log( `- Error while thanking on ${wiki}: ${error}` );
		return context.get('thank_error');
	} );
}
