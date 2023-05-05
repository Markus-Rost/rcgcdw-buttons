import { got, Context, parseErrors } from './util.js';

/** @type {Map<Context, {csrftoken?: String, rollbacktoken?: String}>} */
const tokenCache = new Map();

/** 
 * @param {Context} context
 * @param {String} [type]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<{csrftoken?: String, rollbacktoken?: String}?>}
 */
export async function getToken(context, type = 'csrf', forceRefresh = false) {
	if ( !forceRefresh && tokenCache.has(context) ) {
		let cachedTokens = tokenCache.get(context);
		if ( type.split('|').every( typ => cachedTokens.hasOwnProperty(typ + 'token') ) ) return cachedTokens;
	}
	return got.get( `${context.wiki}api.php`, {
		searchParams: {
			action: 'query',
			meta: 'tokens', type,
			assert: 'user', errorformat: 'plaintext',
			formatversion: 2, format: 'json'
		},
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.batchcomplete || !body?.query?.tokens ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh() ) {
					return getToken(context, type, true);
				}
			}
			console.log( `- ${response.statusCode}: Error while getting the token: ${parseErrors(response)}` );
			return;
		}
		if ( tokenCache.has(context) ) return Object.assign(tokenCache.get(context), body.query.tokens);
		tokenCache.set(context, body.query.tokens);
		return body.query.tokens;
	}, error => {
		console.log( `- Error while getting the token: ${error}` );
		return;
	} );
}