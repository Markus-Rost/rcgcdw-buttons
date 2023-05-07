import gotDefault from 'got';
import { gotSsrf } from 'got-ssrf';
import pg from 'pg';

globalThis.isDebug = ( process.argv[2] === 'debug' );

/*
CREATE TABLE oauthrevert (
    userid  TEXT NOT NULL,
    site    TEXT NOT NULL,
    access  TEXT NOT NULL,
    refresh TEXT NOT NULL,
    UNIQUE (
        userid,
        site
    )
);
*/
export const db = new pg.Pool().on( 'error', dberror => {
	console.log( `- Error while connecting to the database: ${dberror}` );
} );

export const got = gotDefault.extend( {
	throwHttpErrors: false,
	timeout: {
		request: 5000
	},
	headers: {
		'user-agent': 'Recent Changes Revert Actions/' + ( isDebug ? 'testing' : process.env.npm_package_version ) + ' (Discord; ' + process.env.npm_package_name + ( process.env.invite ? '; ' + process.env.invite : '' ) + '; OAuth2)'
	},
	responseType: 'json'
}, gotSsrf );

/** @type {Map<String, {userId: String, interaction: Object}>} */
export const oauthVerify = new Map();

/** @type {Map<String, Context>} */
const contextCache = new Map();

/**
 * Context for a site and user.
 * @class Context
 */
export class Context {
	/**
	 * Creates a context.
	 * @param {Object} row - The database row.
	 * @param {String} row.access - The authorization token.
	 * @param {String} row.refresh - The refresh token.
	 * @param {String} row.userid - The Discord user id.
	 * @param {String} row.site - The OAuth site.
	 * @constructs Context
	 */
	constructor(row) {
		let cacheKey = `${row.userid} ${row.site}`;
		if ( contextCache.has(cacheKey) ) {
			return contextCache.get(cacheKey);
		}
		/** @type {String} */
		this.accessToken = row.access;
		/** @type {String} */
		this.refreshToken = row.refresh;
		/** @type {String} */
		this.userId = row.userid;
		/** @type {String} */
		this.site = row.site;
		contextCache.set(cacheKey, this);
	}

	/**
	 * Refreshes the context tokens.
	 * @param {String} wiki
	 * @returns {Promise<Boolean>}
	 */
	async refresh(wiki) {
		if ( !process.env[`oauth_${this.site}`] && !process.env[`oauth_${this.site}_secret`] ) return false;
		return got.post( `${wiki}rest.php/oauth2/access_token`, {
			form: {
				grant_type: 'refresh_token',
				refresh_token: this.refreshToken,
				redirect_uri: new URL('/oauth', process.env.dashboard).href,
				client_id: process.env[`oauth_${this.site}`],
				client_secret: process.env[`oauth_${this.site}_secret`]
			}
		} ).then( response => {
			var body = response.body;
			if ( response.statusCode !== 200 || !body?.access_token ) {
				console.log( `- ${response.statusCode}: Error while refreshing the mediawiki token: ${body?.message||body?.error}` );
				db.query( 'DELETE FROM oauthrevert WHERE userid = $1 AND site = $2', [this.userId, this.site] ).then( () => {
					console.log( `- OAuth2 token for ${this.userId} on ${this.site} successfully deleted.` );
				}, dberror => {
					console.log( `- Error while deleting the OAuth2 token for ${this.userId} on ${this.site}: ${dberror}` );
				} );
				return false;
			}
			this.accessToken = body.access_token;
			this.refreshToken = body.refresh_token || this.refreshToken;
			db.query( 'UPDATE oauthrevert SET access = $1, refresh = $2 WHERE userid = $3 AND site = $4', [this.accessToken, this.refreshToken, this.userId, this.site] ).then( () => {
				console.log( `- OAuth2 token for ${this.userId} on ${this.site} successfully updated.` );
			}, dberror => {
				console.log( `- Error while updating the OAuth2 token for ${this.userId} on ${this.site}: ${dberror}` );
			} );
			return true;
		}, error => {
			console.log( `- Error while refreshing the mediawiki token: ${error}` );
			return false;
		} );
	}

	static get _cache() {
		return contextCache;
	};
}

export function reply(interaction, message) {
	if ( !message.components ) message.components = [];
	got.patch( `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
		json: message
	} ).catch( error => {
		console.log( `- Error while replying to the interaction: ${error}` );
	} );
}

/**
 * @param {import('got').Response<{errors:{code:String,text:String}[]}>} response
 * @returns {String}
 */
export function parseErrors(response) {
	let error = response?.body?.errors?.map( error => `${error.code}: ${error.text}` ).join(' - ');
	if ( !error ) error = response?.headers?.['mediawiki-api-error'] || response?.statusMessage;
	return error || '';
}