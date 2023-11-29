import { readdir } from 'node:fs';
import { createRequire } from 'node:module';
import gotDefault from 'got';
import { gotSsrf } from 'got-ssrf';
import pg from 'pg';
const require = createRequire(import.meta.url);

globalThis.isDebug = ( process.argv[2] === 'debug' );
export const REDIRECT_URI_WIKI = new URL(process.env.wiki_path, process.env.redirect_uri).href;

/** @type {Map<String, Map<String, String>>} */
const allLangs = new Map();
readdir( './i18n', (error, files) => {
	if ( error ) return error;
	files.filter( file => file.endsWith('.json') ).forEach( file => {
		var translations = require(`../i18n/${file}`);
		var lang = file.slice(0, -5);
		allLangs.set(lang, new Map(Object.entries(translations)));
	} );
} );
/**
 * Get a translated message.
 * @param {String} locale
 * @param {String} message
 * @returns {String}
 */
export function getMessage(locale, message) {
	return allLangs.get(locale)?.get(message) || allLangs.get('en-US')?.get(message) || `⧼${message}⧽`;
}

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

/** @type {Map<String, {id: String, script?: String, url: String}>} */
export const enabledOAuth2 = new Map();
if ( process.env.oauth_wikimedia && process.env.oauth_wikimedia_secret ) {
	enabledOAuth2.set('wikimedia', {
		id: 'wikimedia',
		script: '/w/',
		url: 'https://meta.wikimedia.org/w/'
	});
}
if ( process.env.oauth_wikigg && process.env.oauth_wikigg_secret ) {
	enabledOAuth2.set('wikigg', {
		id: 'wikigg',
		script: '/',
		url: 'https://support.wiki.gg/'
	});
}
if ( process.env.oauth_miraheze && process.env.oauth_miraheze_secret ) {
	enabledOAuth2.set('miraheze', {
		id: 'miraheze',
		script: '/w/',
		url: 'https://meta.miraheze.org/w/'
	});
}
if ( process.env.oauth_wikitide && process.env.oauth_wikitide_secret ) {
	enabledOAuth2.set('wikitide', {
		id: 'wikitide',
		script: '/w/',
		url: 'https://meta.wikitide.org/w/'
	});
}
if ( process.env.oauth_telepedia && process.env.oauth_telepedia_secret ) {
	enabledOAuth2.set('telepedia', {
		id: 'telepedia',
		script: '/',
		url: 'https://meta.telepedia.net/'
	});
}
if ( process.env['oauth_minecraft.wiki'] && process.env['oauth_minecraft.wiki_secret'] ) {
	enabledOAuth2.set('minecraft.wiki', {
		id: 'minecraft.wiki',
		script: '/',
		url: 'https://minecraft.wiki/'
	});
}
if ( process.env['oauth_lakeus.xyz'] && process.env['oauth_lakeus.xyz_secret'] ) {
	enabledOAuth2.set('lakeus.xyz', {
		id: 'lakeus.xyz',
		script: '/',
		url: 'https://lakeus.xyz/'
	});
}

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
	 * @param {String} locale - The language of the Discord user.
	 * @constructs Context
	 */
	constructor(row, locale) {
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
		/** @type {String} */
		this.locale = ( allLangs.has(locale) ? locale : 'en-US' );
		contextCache.set(cacheKey, this);
	}
	/**
	 * Update the Discord users locale.
	 * @param {String} locale
	 * @returns {this}
	 */
	updateLocale(locale) {
		if ( allLangs.has(locale) ) this.locale = locale;
		return this;
	}

	/**
	 * Get a translated message.
	 * @param {String} message
	 * @returns {String}
	 */
	get(message) {
		return getMessage(this.locale, message);
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
				redirect_uri: REDIRECT_URI_WIKI,
				client_id: process.env[`oauth_${this.site}`],
				client_secret: process.env[`oauth_${this.site}_secret`]
			}
		} ).then( response => {
			var body = response.body;
			if ( response.statusCode !== 200 || !body?.access_token ) {
				console.log( `- ${response.statusCode}: Error while refreshing the OAuth2 token on ${wiki}: ${body?.message||body?.error}` );
				db.query( 'DELETE FROM oauthrevert WHERE userid = $1 AND site = $2', [this.userId, this.site] ).then( () => {
					console.log( `- OAuth2 token for ${this.userId} on ${this.site} successfully deleted.` );
				}, dberror => {
					console.log( `- Error while deleting the OAuth2 token for ${this.userId} on ${this.site}: ${dberror}` );
				} );
				contextCache.delete(`${this.userId} ${this.site}`);
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
			console.log( `- Error while refreshing the OAuth2 token on ${wiki}: ${error}` );
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
		json: message,
		throwHttpErrors: true
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

/** @type {{miraheze: Set<String>, wikitide: Set<String>}} */
export const customDomainWikis = {
	miraheze: new Set(),
	wikitide: new Set()
};
got.get( 'https://raw.githubusercontent.com/miraheze/ssl/master/certs.yaml', {
	responseType: 'text',
	throwHttpErrors: true
} ).then( response => {
	if ( !response?.body?.includes?.( '# Production' ) ) return;
	response.body.split('# Production')[1].match(/(?<=url: ')[a-z0-9.-]+(?=')/g).forEach( wiki => customDomainWikis.miraheze.add(wiki) );
}, error => {
	console.log( `- Error while getting the Miraheze wikis: ${error}` );
} );
got.get( 'https://raw.githubusercontent.com/WikiTideOrg/ssl/master/certs.yaml', {
	responseType: 'text',
	throwHttpErrors: true
} ).then( response => {
	if ( !response?.body?.includes?.( '# Production' ) ) return;
	response.body.split('# Production')[1].match(/(?<=url: ')[a-z0-9.-]+(?=')/g).forEach( wiki => customDomainWikis.wikitide.add(wiki) );
}, error => {
	console.log( `- Error while getting the WikiTide wikis: ${error}` );
} );
