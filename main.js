import 'dotenv/config';
import { createServer, STATUS_CODES } from 'node:http';
import { verify } from 'node:crypto';
import { db, got, enabledOAuth2, oauthVerify } from './src/util.js';
import { buttons } from './src/index.js';

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
					case 5:
						await buttons(interaction, result);
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
					if ( result.data?.custom_id ) result.data.custom_id = `rc_${result.data.custom_id}`;
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
		let oauthSite = enabledOAuth2.get(site[0]);
		if ( !oauthSite || !oauthVerify.has(state) ) {
			res.writeHead(302, {Location: '/?oauth=failed'});
			return res.end();
		}
		let url = oauthSite.url;
		if ( new RegExp( `^https://[a-z0-9\\.-]*\\b${oauthSite.id}\\b.*/$` ).test(site[2]) ) url = site[2];
		return got.post( `${url}rest.php/oauth2/access_token`, {
			form: {
				grant_type: 'authorization_code',
				code: reqURL.searchParams.get('code'),
				redirect_uri: process.env.dashboard,
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
			let data = oauthVerify.get(state);
			db.query( 'INSERT INTO oauthrevert(userid, site, access, refresh) VALUES ($1, $2, $3, $4)', [data.userId, oauthSite.id, body.access_token, body.refresh_token] ).then( () => {
				console.log( `- RcGcDw buttons: OAuth2 token for ${data.userId} on ${oauthSite.id} successfully saved.` );
				buttons(data.interaction);
			}, dberror => {
				console.log( `- RcGcDw buttons: Error while saving the OAuth2 token for ${data.userId} on ${oauthSite.id}: ${dberror}` );
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
		let body = 'Hi';
		res.writeHead(200, {
			'Content-Length': Buffer.byteLength(body)
		});
		res.write( body );
		return res.end();
	}
} );

server.listen( 8800, 'localhost', () => {
	console.log( '- RcGcDw buttons: Server running at http://localhost:8800/' );
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