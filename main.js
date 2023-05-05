import 'dotenv/config';
import { createServer, STATUS_CODES } from 'node:http';
import { verify } from 'node:crypto';
import { db, got, oauthVerify } from './src/util.js';
import { buttons } from './src/buttons.js';


/** @type {{id:String,name:String,url:String}[]} */
const enabledOAuth2 = [];
if ( process.env.oauth_wikimedia && process.env.oauth_wikimedia_secret ) {
	enabledOAuth2.push({
		id: 'wikimedia',
		name: 'Wikimedia (Wikipedia)',
		url: 'https://meta.wikimedia.org/w/'
	});
}
if ( process.env.oauth_miraheze && process.env.oauth_miraheze_secret ) {
	enabledOAuth2.push({
		id: 'miraheze',
		name: 'Miraheze',
		url: 'https://meta.miraheze.org/w/'
	});
}
if ( process.env.oauth_wikiforge && process.env.oauth_wikiforge_secret ) {
	enabledOAuth2.push({
		id: 'wikiforge',
		name: 'WikiForge',
		url: 'https://meta.wikiforge.net/w/'
	});
}

const server = createServer( (req, res) => {
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
	res.setHeader('Content-Type', 'text/html');
	res.setHeader('Content-Language', ['en']);

	if ( req.method === 'POST' && req.url === '/interactions' ) {
		let body = [];
		req.on( 'data', chunk => {
			body.push(chunk);
		} );
		req.on( 'error', () => {
			console.log( error );
			res.end('error');
		} );
		return req.on( 'end', async () => {
			var rawBody = Buffer.concat(body).toString();
			console.log(rawBody)
			let signature = req.headers['x-signature-ed25519'];
			let timestamp = req.headers['x-signature-timestamp'];
			if ( req.headers.authorization !== process.env.token && ( !process.env.key || !signature || !timestamp
			 || !verify(null, Buffer.from(timestamp + rawBody), Buffer.from(process.env.key, 'hex'), Buffer.from(signature, 'hex')) ) ) {
				res.statusCode = 401;
				return res.end();
			}
			try {
				var interaction = JSON.parse(rawBody);
				res.statusCode = 200;
				var result = {
					data: {
						flags: 1 << 6,
						allowed_mentions: {
							parse: []
						}
					}
				};
				switch ( interaction.type ) {
					case 1:
						result.type = 1;
						break;
					case 3:
						if ( interaction.data?.component_type === 2 ) {
							await buttons(interaction, result);
							break;
						}
					default:
						result.type = 4;
						result.data.content = 'Error: Unknown interaction!';
				}
				let response = JSON.stringify(result);
				if ( req.headers.authorization === process.env.token ) {
					got.post( `https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`, {
						json: result
					} ).catch( error => {
						console.log( `- Error while responding to the interaction: ${error}` );
					} );
					response = '{"result": "Success"}';
				}
				res.writeHead(200, {
					'Content-Length': Buffer.byteLength(response),
					'Content-Type': 'application/json'
				});
				res.write( response );
				res.end();
			}
			catch ( jsonerror ) {
				console.log( jsonerror );
				res.statusCode = 500;
				return res.end();
			}
		} );
	}

	if ( req.method !== 'GET' ) {
		let body = '<img width="400" src="https://http.cat/418"><br><strong>' + STATUS_CODES[418] + '</strong>';
		res.writeHead(418, {
			'Content-Length': Buffer.byteLength(body)
		});
		res.write( body );
		return res.end();
	}

	var reqURL = new URL(req.url, process.env.dashboard);

	if ( reqURL.pathname === '/oauth' ) {
		if ( !reqURL.searchParams.get('code') || !reqURL.searchParams.get('state') ) {
			res.writeHead(302, {Location: '/?oauth=failed'});
			return res.end();
		}
		let state = reqURL.searchParams.get('state');
		let site = state.split(' ');
		let oauthSite = enabledOAuth2.find( oauthSite => ( site[2] || site[0] ) === oauthSite.id );
		if ( !oauthSite || !oauthVerify.has(state) ) {
			res.writeHead(302, {Location: '/?oauth=failed'});
			return res.end();
		}
		let url = oauthSite.url;
		if ( oauthVerify.has(state) && site[2] === oauthSite.id ) url = 'https://' + site[0] + '/';
		return got.post( `${url}rest.php/oauth2/access_token`, {
			form: {
				grant_type: 'authorization_code',
				code: reqURL.searchParams.get('code'),
				redirect_uri: new URL('/oauth', process.env.dashboard).href,
				client_id: process.env[`oauth_${oauthSite.id}`],
				client_secret: process.env[`oauth_${oauthSite.id}_secret`]
			}
		} ).then( response => {
			var body = response.body;
			if ( response.statusCode !== 200 || !body?.access_token ) {
				console.log( `- RcGcDw buttons: ${response.statusCode}: Error while getting the mediawiki token: ${body?.message||body?.error}` );
				res.writeHead(302, {Location: '/?oauth=failed'});
				return res.end();
			}
			let userId = oauthVerify.get(state);
			db.query( 'INSERT INTO oauthrevert(userid, site, access, refresh) VALUES ($1, $2, $3, $4)', [userId, oauthSite.id, body.access_token, body.refresh_token] ).then( () => {
				console.log( `- RcGcDw buttons: OAuth2 token for ${userId} on ${oauthSite.id} successfully saved.` );
			}, dberror => {
				console.log( `- RcGcDw buttons: Error while saving the OAuth2 token for ${userId} on ${oauthSite.id}: ${dberror}` );
			} );
			oauthVerify.delete(state);
			res.writeHead(302, {Location: '/?oauth=success'});
			return res.end();
		}, error => {
			console.log( `- RcGcDw buttons: Error while getting the mediawiki token: ${error}` );
			res.writeHead(302, {Location: '/?oauth=failed'});
			return res.end();
		} );
	}
	else {
		/*
		let state = `meta.miraheze.org/w ${Date.now().toString(16)}${randomBytes(16).toString('hex')} miraheze`;
		while ( oauthVerify.has(state) ) {
			state = `meta.miraheze.org/w ${Date.now().toString(16)}${randomBytes(16).toString('hex')} miraheze`;
		}
		oauthVerify.set(state, USERID);
		let oauthURL = 'https://meta.miraheze.org/w/rest.php/oauth2/authorize?' + new URLSearchParams({
			response_type: 'code', redirect_uri: new URL('/oauth', process.env.dashboard).href,
			client_id: process.env['oauth_miraheze'], state
		}).toString();
		let body = `<a href="${oauthURL}">${oauthURL}</a>`;
		*/
		let body = 'Hi';
		res.writeHead(200, {
			'Content-Length': Buffer.byteLength(body)
		});
		res.write( body );
		return res.end();
	}
} );

server.listen( 8000, 'localhost', () => {
	console.log( '- RcGcDw buttons: Server running at http://localhost:8000/' );
} );

/**
 * End the process gracefully.
 * @param {NodeJS.Signals} signal - The signal received.
 */
function graceful(signal) {
	console.log(signal);
	server.close( () => {
		console.log( '- ' + signal + ': Closed the server.' );
		db.end().then( () => {
			console.log( '- ' + signal + ': Closed the database connection.' );
			process.exit(0);
		}, dberror => {
			console.log( '- ' + signal + ': Error while closing the database connection: ' + dberror );
		} );
	} );
}

process.on( 'SIGHUP', graceful );
process.on( 'SIGINT', graceful );
process.on( 'SIGTERM', graceful );
process.on( 'SIGINT SIGTERM', graceful );