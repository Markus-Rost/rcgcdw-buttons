import { got, RefreshTokenError, Context, parseErrors } from './util.js';

/** @type {Map<String, {csrftoken?: String, rollbacktoken?: String}>} */
const tokenCache = new Map();

/** 
 * @param {String} wiki
 * @param {Context} context
 * @param {String} [type]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<{csrftoken?: String, rollbacktoken?: String}?>}
 * @throws {RefreshTokenError}
 */
export async function getToken(wiki, context, type = 'csrf', forceRefresh = false) {
	let cacheKey = `${wiki} ${context.userId} ${context.site}`;
	if ( !forceRefresh && tokenCache.has(cacheKey) ) {
		let cachedTokens = tokenCache.get(cacheKey);
		if ( type.split('|').every( typ => cachedTokens.hasOwnProperty(typ + 'token') ) ) return cachedTokens;
	}
	return got.get( `${wiki}api.php`, {
		searchParams: {
			action: 'query', meta: 'tokens', type,
			assert: 'user', errorlang: 'en',
			errorformat: 'plaintext',
			formatversion: 2, format: 'json'
		},
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.batchcomplete || !body?.query?.tokens ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
					return getToken(wiki, context, type, true);
				}
			}
			console.log( `- ${response.statusCode}: Error while getting the token on ${wiki}: ${parseErrors(response)}` );
			return;
		}
		if ( tokenCache.has(cacheKey) ) return Object.assign(tokenCache.get(cacheKey), body.query.tokens);
		tokenCache.set(cacheKey, body.query.tokens);
		return body.query.tokens;
	}, error => {
		console.log( `- Error while getting the token on ${wiki}: ${error}` );
		return;
	} );
}