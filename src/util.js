import { readdir } from 'node:fs';
import { randomBytes } from 'node:crypto';
import gotDefault from 'got';
import { gotSsrf } from 'got-ssrf';
import pg from 'pg';

globalThis.isDebug = ( process.argv[2] === 'debug' );
export const REDIRECT_URI_WIKI = new URL(process.env.wiki_path, process.env.redirect_uri).href;

/** @type {Map<String, Map<String, String>>} */
const allLangs = new Map();
readdir( './i18n', (error, files) => {
	if ( error ) return error;
	files.filter( file => file.endsWith('.json') ).forEach( async file => {
		var translations = ( await import(`../i18n/${file}`, {with: {type: 'json'}}) ).default;
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
if ( process.env.oauth_telepedia && process.env.oauth_telepedia_secret ) {
	enabledOAuth2.set('telepedia', {
		id: 'telepedia',
		script: '/',
		url: 'https://meta.telepedia.net/'
	});
}
if ( process.env.oauth_wikioasis && process.env.oauth_wikioasis_secret ) {
	enabledOAuth2.set('wikioasis', {
		id: 'wikioasis',
		script: '/',
		url: 'https://meta.wikioasis.org/'
	});
}
if ( process.env['oauth_minecraft.wiki'] && process.env['oauth_minecraft.wiki_secret'] ) {
	enabledOAuth2.set('minecraft.wiki', {
		id: 'minecraft.wiki',
		script: '/',
		url: 'https://meta.minecraft.wiki/'
	});
}
if ( process.env['oauth_lakeus.xyz'] && process.env['oauth_lakeus.xyz_secret'] ) {
	enabledOAuth2.set('lakeus.xyz', {
		id: 'lakeus.xyz',
		script: '/',
		url: 'https://lakeus.xyz/'
	});
}

/** @type {Map<String, {userId: String, interaction: import('discord-api-types/v10').APIMessageComponentGuildInteraction|import('discord-api-types/v10').APIModalSubmitGuildInteraction}>} */
export const oauthVerify = new Map();

/** @type {Map<String, {[Message: String]: String}>} */
export const mwMessageCache = new Map();

/**
 * Error due to invalid refresh token.
 * @class RefreshTokenError
 * @extends Error
 */
export class RefreshTokenError extends Error {
	/**
	 * Creates a refresh token error.
	 * @param {String} message - A human-readable description of the error.
	 * @constructs RefreshTokenError
	 */
	constructor(message) {
		super(message);
		this.name = 'RefreshTokenError';
	}
}

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
	 * @throws {RefreshTokenError}
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
				if ( response.statusCode === 401 && body?.error === 'invalid_request' && body.message === 'The refresh token is invalid.' ) {
					throw new RefreshTokenError(body.message);
				}
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

	/**
	 * Revokes the context tokens.
	 * @returns {RefreshTokenError}
	 */
	revoke() {
		console.log( `- Authorization for ${this.userId} on ${this.site} has been revoked.` );
		db.query( 'DELETE FROM oauthrevert WHERE userid = $1 AND site = $2', [this.userId, this.site] ).then( () => {
			console.log( `- OAuth2 token for ${this.userId} on ${this.site} successfully deleted.` );
		}, dberror => {
			console.log( `- Error while deleting the OAuth2 token for ${this.userId} on ${this.site}: ${dberror}` );
		} );
		contextCache.delete(`${this.userId} ${this.site}`);
		return new RefreshTokenError('Cannot create access token, user did not approve issuing this access token');
	}

	static get _cache() {
		return contextCache;
	};
}

/** 
 * @param {import('discord-api-types/v10').APIMessageComponentGuildInteraction|import('discord-api-types/v10').APIModalSubmitGuildInteraction} interaction
 * @param {import('discord-api-types/v10').APIInteractionResponseCallbackData} message
 */
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
 * @param {import('discord-api-types/v10').APIMessageComponentGuildInteraction|import('discord-api-types/v10').APIModalSubmitGuildInteraction} interaction
 * @param {String} userId
 * @param {String} oauthSite
 * @param {String} wiki
 */
export function sendButton(interaction, userId, oauthSite, wiki) {
	let state = `${oauthSite} ${Date.now().toString(16)}${randomBytes(16).toString('hex')} ${wiki}`;
	while ( oauthVerify.has(state) ) {
		state = `${oauthSite} ${Date.now().toString(16)}${randomBytes(16).toString('hex')} ${wiki}`;
	}
	oauthVerify.set(state, {userId, interaction});
	let oauthURL = `${wiki}rest.php/oauth2/authorize?` + new URLSearchParams({
		response_type: 'code', state,
		redirect_uri: REDIRECT_URI_WIKI,
		client_id: process.env[`oauth_${oauthSite}`]
	}).toString();
	/** @type {import('discord-api-types/v10').APIInteractionResponseCallbackData} */
	let message = {
		content: `[${getMessage(interaction.locale, 'oauth_message')}](<${oauthURL}>)`,
		components: [{
			type: 1,
			components: [{
				type: 2,
				label: getMessage(interaction.locale, 'oauth_button'),
				style: 5,
				url: oauthURL,
				emoji: {
					id: null,
					name: '🔗'
				}
			}]
		}],
		flags: 1 << 6,
		allowed_mentions: {
			parse: []
		}
	};
	return reply(interaction, message);
}

/**
 * @param {import('got').Response<({errors:{code:String,text:String}[],error:{[a:String]:{code:String,message:String}[]}})>} response
 * @returns {String}
 */
export function parseErrors(response) {
	let error = response?.body?.errors?.map( error => `${error.code}: ${error.text}` ).join(' - ');
	if ( !error && response?.body?.error ) {
		let errors = Object.keys( response.body.error ).flatMap( errorCat => response.body.error[errorCat] );
		error = errors.map( error => `${error.code}: ${error.message}` ).join(' - ');
	}
	if ( !error ) error = response?.headers?.['mediawiki-api-error'] || response?.statusMessage;
	return error || '';
}

/** @type {{miraheze: Set<String>}} */
export const customDomainWikis = {
	miraheze: new Set()
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
