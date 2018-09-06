/* global describe, require, it, beforeEach, afterEach */
// safer to ensure this here (in addition to grunt:env:test)
process.env.NODE_ENV = 'test';

/* 
 * Some of these tests use the special test Api Token and Server URLs defined in the API spec
 * at http://apidocs.enketo.org.
 */
const request = require( 'supertest' );
const config = require( '../../app/models/config-model' ).server;
config[ 'base path' ] = '';
const app = require( '../../config/express' );
app.set( 'jini', {
    'style url': 'http://example.com/style.css',
    'script url': 'http://example.com/script.css'
} );
const surveyModel = require( '../../app/models/survey-model' );
const instanceModel = require( '../../app/models/instance-model' );
const redis = require( 'redis' );
const client = redis.createClient( config.redis.main.port, config.redis.main.host, {
    auth_pass: config.redis.main.password
} );


describe( 'api', () => {
    const validApiKey = 'abc';
    const validAuth = {
        'Authorization': `Basic ${new Buffer( `${validApiKey}:` ).toString( 'base64' )}`
    };
    const invalidApiKey = 'def';
    const invalidAuth = {
        'Authorization': `Basic ${new Buffer( `${invalidApiKey}:` ).toString( 'base64' )}`
    };
    const beingEdited = 'beingEdited';
    const validServer = 'https://testserver.com/bob';
    const validFormId = 'something';

    beforeEach( done => {
        // add survey if it doesn't exist in the db
        surveyModel.set( {
            openRosaServer: validServer,
            openRosaId: validFormId,
        } ).then( () => {
            done();
        } );
    } );

    afterEach( done => {
        // select test database and flush it
        client.select( 15, err => {
            if ( err ) {
                return done( err );
            }
            client.flushdb( err => {
                if ( err ) {
                    return done( err );
                }
                return instanceModel.set( {
                    openRosaServer: validServer,
                    openRosaId: validFormId,
                    instanceId: beingEdited,
                    returnUrl: 'https://enketo.org',
                    instance: '<data></data>'
                } ).then( () => {
                    done();
                } );
            } );
        } );

    } );

    // return error if it fails
    function responseCheck( value, expected ) {
        if ( typeof expected === 'string' || typeof expected === 'number' ) {
            if ( value !== expected ) {
                return new Error( `Response ${value} not equal to ${expected}` );
            }
        } else if ( expected instanceof RegExp && typeof value === 'object' ) {
            if ( !expected.test( JSON.stringify( value ) ) ) {
                return new Error( `Response ${JSON.stringify( value )} not matching ${expected}` );
            }
        } else if ( expected instanceof RegExp ) {
            if ( !expected.test( value ) ) {
                return new Error( `Response ${value} not matching ${expected}` );
            }
        } else {
            return new Error( 'This is not a valid expected value' );
        }
    }

    function testResponse( test ) {
        const authDesc = test.auth === true ? 'valid' : ( test.auth === false ? 'invalid' : 'empty' );
        const auth = test.auth === true ? validAuth : ( test.auth === false ? invalidAuth : {} );
        const version = test.version;
        const server = ( typeof test.server !== 'undefined' ) ? test.server : validServer;
        const id = typeof test.id !== 'undefined' ? ( test.id !== '{{random}}' ? test.id : Math.floor( Math.random() * 10000 ).toString() ) : validFormId;
        const ret = test.ret === true ? 'http://example.com' : test.ret;
        const instance = test.instance === true ? '<data/>' : test.instance;
        const instanceId = test.instanceId === true ? `UUID:${Math.random()}` : test.instanceId;
        const endpoint = test.endpoint;
        const dataSendMethod = ( test.method === 'get' ) ? 'query' : 'send';
        const ecid = typeof test.ecid === 'undefined' ? 'a1b1' : test.ecid;
        const pid = typeof test.pid === 'undefined' ? 'qwe' : test.pid;

        it( `${test.method.toUpperCase()} /oc/api/v${version}${endpoint} with ${authDesc} authentication ` +
            `and ${server}, ${id}, ${ret}, ${instance}, ${instanceId}, ${test.theme}, ` +
            `parentWindowOrigin: ${test.parentWindowOrigin}, defaults: ${JSON.stringify( test.defaults )}, ` +
            `åpid:${pid}, ecid:${ecid}, jini:${test.jini} responds with ${test.status}`,
            done => {
                request( app )[ test.method ]( `/oc/api/v${version}${endpoint}` )
                    .set( auth )[ dataSendMethod ]( {
                        server_url: server,
                        form_id: id,
                        ecid,
                        pid,
                        instance,
                        instance_id: instanceId,
                        return_url: ret,
                        go_to: test.goTo,
                        go_to_error_url: test.goToErrorUrl,
                        jini: test.jini,
                        format: test.format,
                        margin: test.margin,
                        landscape: test.landscape,
                        defaults: test.defaults,
                        load_warning: test.warning,
                        parent_window_origin: test.parentWindowOrigin
                    } )
                    .expect( test.status )
                    .expect( resp => {
                        if ( test.expected ) {
                            return responseCheck( resp.body.url, test.expected );
                        }
                    } )
                    .end( done );
            } );
    }

    describe( 'oc/api/v1 endpoints', () => {
        const version = '1';

        // /survey*
        describe( '', () => {
            // GET /version
            testResponse( {
                version,
                endpoint: '/version',
                method: 'get',
                auth: false,
                status: 200,
                res: {
                    property: 'version',
                    expected: /.{6,20}/
                }
            } );
            // POST /version
            testResponse( {
                version,
                endpoint: '/version',
                method: 'post',
                auth: false,
                status: 200,
                res: {
                    property: 'version',
                    expected: /.{6,20}/
                }
            } );
            // POST /survey/collect
            testResponse( {
                version,
                endpoint: '/survey/collect',
                method: 'post',
                ret: false,
                auth: true,
                status: 200,
                expected: /\/single\/fs\/i\/::[A-z0-9]{8,10}/,
            } );
            // GET /survey/collect
            testResponse( {
                version,
                endpoint: '/survey/collect',
                method: 'get',
                ret: false,
                auth: true,
                status: 405
            } );
            // POST /survey/collect with parent_window_origin
            testResponse( {
                version,
                endpoint: '/survey/collect',
                method: 'post',
                parentWindowOrigin: 'http://example.com',
                ret: false,
                auth: true,
                status: 200,
                expected: /\/single\/fs\/i\/::[A-z0-9]{8,10}.*(\?|&)parentWindowOrigin=http%3A%2F%2Fexample\.com/,
            } );
            // POST /survey/collect/c
            testResponse( {
                version,
                endpoint: '/survey/collect/c',
                method: 'post',
                ret: false,
                auth: true,
                status: 200,
                expected: /\/single\/fs\/c\/i\/::[A-z0-9]{32}/,
            } );
            // with parent_window_origin
            testResponse( {
                version,
                endpoint: '/survey/collect/c',
                method: 'post',
                parentWindowOrigin: 'http://example.com',
                ret: false,
                auth: true,
                status: 200,
                expected: /\/single\/fs\/c\/i\/::[A-z0-9]{32}.*(\?|&)parentWindowOrigin=http%3A%2F%2Fexample\.com/,
            } );
            // POST /survey/view
            testResponse( {
                version,
                endpoint: '/survey/view',
                method: 'post',
                ret: false,
                auth: true,
                status: 200,
                expected: /\/view\/fs\/i\/::[A-z0-9]{32}/,
            } );
            // POST /survey/view with go_to
            testResponse( {
                version,
                endpoint: '/survey/view',
                method: 'post',
                goTo: '//myquestion',
                ret: false,
                auth: true,
                status: 200,
                expected: /\/view\/fs\/i\/::[A-z0-9]{32}.*#\/\/myquestion$/,
            } );
            // POST /survey/view with go_to and go_to_error_url
            testResponse( {
                version,
                endpoint: '/survey/view',
                method: 'post',
                goTo: '//myquestion',
                goToErrorUrl: 'http://example.com/miniform',
                ret: false,
                auth: true,
                status: 200,
                expected: /\/view\/fs\/i\/::[A-z0-9]{32}.*(\?|&)goToErrorUrl=http%3A%2F%2Fexample\.com%2Fminiform#\/\/myquestion/,
            } );
            // POST /survey/view without go_to and with (ignored) go_to_error_url
            testResponse( {
                version,
                endpoint: '/survey/view',
                method: 'post',
                goToErrorUrl: 'https://example.com/miniform',
                ret: false,
                auth: true,
                status: 200,
                expected: /\/view\/fs\/i\/::[A-z0-9]{32}/,
            } );
            // POST /survey/view with load warning
            testResponse( {
                version,
                endpoint: '/survey/view',
                method: 'post',
                ret: false,
                warning: 'hey you',
                auth: true,
                status: 200,
                expected: /\/view\/fs\/i\/::[A-z0-9]{32}.*(\?|&)loadWarning=hey%20you/,
            } );
            // POST /survey/preview
            testResponse( {
                version,
                endpoint: '/survey/preview',
                method: 'post',
                ret: false,
                auth: true,
                status: 200,
                expected: /\/preview\/i\/::[A-z0-9]{8,10}/,
            } );
        } );

        // /instance/*
        describe( '', () => {
            [
                // valid token
                {
                    method: 'post',
                    auth: true,
                    instanceId: 'AAA',
                    instance: true,
                    status: 201,
                    // includes proper enketoID and not e.g. ::null 
                    expected: /::[A-z0-9]{8,10}/
                },
                // valid token and not being edited, but formId doesn't exist in db yet (no enketoId)
                {
                    method: 'post',
                    auth: true,
                    id: '{{random}}',
                    instanceId: true,
                    instance: true,
                    status: 201,
                    // includes proper enketoID and not e.g. ::null 
                    expected: /::[A-z0-9]{8,10}/
                },
                // already being edited
                {
                    method: 'post',
                    auth: true,
                    instanceId: beingEdited,
                    instance: true,
                    status: 405
                },
                // test return url in response
                {
                    method: 'post',
                    auth: true,
                    ret: 'https://enke.to',
                    instanceId: true,
                    instance: true,
                    status: 201,
                    expected: /.+(\?|&)returnUrl=https%3A%2F%2Fenke.to/,
                },
                // invalid parameters
                {
                    method: 'post',
                    auth: true,
                    id: '',
                    instanceId: true,
                    instance: true,
                    status: 400
                }, {
                    method: 'post',
                    auth: true,
                    instance: '',
                    instanceId: true,
                    status: 400
                }, {
                    method: 'post',
                    auth: true,
                    instanceId: '',
                    instance: true,
                    status: 400
                }, {
                    method: 'post',
                    auth: true,
                    instanceId: true,
                    instance: true,
                    server: '',
                    status: 400
                }
            ].map( obj => {
                obj.version = version;
                obj.endpoint = '/instance/edit';
                return obj;
            } ).forEach( testResponse );

            // /instance/view/pdf
            [ {
                endpoint: '/instance/view/pdf',
                method: 'get',
                auth: true,
                id: 'invalidID',
                instance: true,
                instanceId: true,
                status: 405,
                offline: true
            }, {
                endpoint: '/instance/view/pdf',
                method: 'post',
                auth: true,
                instance: true,
                instanceId: true,
                margin: '10px',
                status: 400,
                offline: true
            }, {
                endpoint: '/instance/view/pdf',
                method: 'post',
                auth: true,
                instance: true,
                instanceId: true,
                margin: '10',
                status: 400,
                offline: true,
                res: {
                    property: 'message',
                    expected: /Margin/
                }
            }, {
                endpoint: '/instance/view/pdf',
                method: 'post',
                auth: true,
                instance: true,
                instanceId: true,
                margin: '1in',
                format: 'fake',
                status: 400,
                offline: true,
                res: {
                    property: 'message',
                    expected: /Format/
                }
            }, {
                endpoint: '/instance/view/pdf',
                method: 'post',
                auth: true,
                instance: true,
                instanceId: true,
                margin: '1.1cm',
                format: 'A4',
                landscape: 'yes',
                status: 400,
                offline: true,
                res: {
                    property: 'message',
                    expected: /Landscape/
                }
            }, {
                endpoint: '/instance/view/pdf',
                method: 'post',
                auth: true,
                instance: false,
                status: 400,
                offline: true,
                res: {
                    property: 'message',
                    expected: /Survey/
                }
            }, {
                endpoint: '/instance/view/pdf',
                method: 'post',
                auth: true,
                margin: '10px',
                instance: true,
                status: 400,
                offline: true,
                res: {
                    property: 'message',
                    expected: /Margin/
                }
            } ].map( obj => {
                obj.version = version;
                return obj;
            } ).forEach( testResponse );

            [ {
                // edit with Close button in dn widget
                method: 'post',
                endpoint: '/instance/edit/c',
                auth: true,
                instanceId: 'AAA',
                instance: true,
                status: 201,
                expected: /\/edit\/fs\/c\/i\/::[A-z0-9]{32}.*(\?|&)instance_id=AAA/
            }, {
                // edit with RFC UI
                method: 'post',
                endpoint: '/instance/edit/rfc',
                auth: true,
                instanceId: 'AAA',
                instance: true,
                status: 201,
                // includes proper enketoID and not e.g. ::null 
                expected: /\/edit\/fs\/rfc\/i\/::[A-z0-9]{32}.*(\?|&)instance_id=AAA/
            }, {
                // edit with RFC UI and with Close button in dn widget
                method: 'post',
                endpoint: '/instance/edit/rfc/c',
                auth: true,
                instanceId: 'AAA',
                instance: true,
                status: 201,
                // includes proper enketoID and not e.g. ::null 
                expected: /\/edit\/fs\/rfc\/c\/i\/::[A-z0-9]{32}.*(\?|&)instance_id=AAA/
            } ].map( obj => {
                obj.version = version;
                return obj;
            } ).forEach( testResponse );

            const noteOnlyInstanceTests = [
                // valid token
                {
                    method: 'post',
                    auth: true,
                    instanceId: 'AAA',
                    instance: true,
                    status: 201,
                    // includes proper enketoID and not e.g. ::null 
                    expected: /\/edit\/fs\/dn(\/c)?\/i\/::[A-z0-9]{32}.*(\?|&)instance_id=AAA/
                },
                // valid token and not being edited, but formId doesn't exist in db yet (no enketoId)
                {
                    method: 'post',
                    auth: true,
                    id: '{{random}}',
                    instanceId: true,
                    instance: true,
                    status: 201,
                    // includes proper enketoID and not e.g. ::null 
                    expected: /\/edit\/fs\/dn(\/c)?\/i\/::[A-z0-9]{32}.*(\?|&)instance_id/
                },
                // already being edited
                {
                    method: 'post',
                    auth: true,
                    instanceId: beingEdited,
                    instance: true,
                    status: 405
                },
                // test return url in response
                {
                    method: 'post',
                    auth: true,
                    ret: 'https://enke.to',
                    instanceId: true,
                    instance: true,
                    status: 201,
                    expected: /.+(\?|&)returnUrl=https%3A%2F%2Fenke.to/
                },
                // test parentWindowOrigin
                {
                    method: 'post',
                    auth: true,
                    parentWindowOrigin: 'http://example.com',
                    ret: false,
                    instanceId: true,
                    instance: true,
                    status: 201,
                },
                // test go_to stuff in response
                {
                    method: 'post',
                    auth: true,
                    ret: 'https://enke.to',
                    goTo: '//hell',
                    goToErrorUrl: 'http://example.com/error',
                    instanceId: true,
                    instance: true,
                    status: 201,
                    expected: /.+&goToErrorUrl=http%3A%2F%2Fexample\.com%2Ferror#\/\/hell$/
                },
                // invalid parameters
                {
                    method: 'post',
                    auth: true,
                    id: '',
                    instanceId: true,
                    instance: true,
                    status: 400
                }, {
                    method: 'post',
                    auth: true,
                    instance: '',
                    instanceId: true,
                    status: 400
                }, {
                    method: 'post',
                    auth: true,
                    instanceId: '',
                    instance: true,
                    status: 400
                }, {
                    method: 'post',
                    auth: true,
                    instanceId: true,
                    instance: true,
                    server: '',
                    status: 400
                }
            ];

            noteOnlyInstanceTests.map( obj => {
                obj.version = version;
                obj.endpoint = '/instance/note';
                return obj;
            } ).forEach( testResponse );

            noteOnlyInstanceTests.map( obj => {
                obj.version = version;
                obj.endpoint = '/instance/note/c';
                return obj;
            } ).forEach( testResponse );

            // Readonly tests
            [
                // valid token
                {
                    method: 'post',
                    auth: true,
                    instanceId: 'AAA',
                    instance: true,
                    status: 201,
                    // includes proper enketoID and not e.g. ::null 
                    expected: /\/view\/fs\/i\/::[A-z0-9]{32}.*(\?|&)instance_id=AAA/
                },
                // valid token and not being edited, but formId doesn't exist in db yet (no enketoId)
                {
                    method: 'post',
                    auth: true,
                    id: '{{random}}',
                    instanceId: true,
                    instance: true,
                    status: 201,
                    // includes proper enketoID and not e.g. ::null 
                    expected: /\/view\/fs\/i\/::[A-z0-9]{32}.*(\?|&)instance_id/
                },
                // already being edited
                {
                    method: 'post',
                    auth: true,
                    instanceId: beingEdited,
                    instance: true,
                    status: 405
                },
                // test load warning in response
                {
                    method: 'post',
                    auth: true,
                    warning: 'A warning',
                    instanceId: true,
                    instance: true,
                    status: 201,
                    expected: /.+(\?|&)loadWarning=A%20warning/
                },
                // test return url in response
                {
                    method: 'post',
                    auth: true,
                    ret: 'https://enke.to',
                    instanceId: true,
                    instance: true,
                    status: 201,
                    expected: /.+(\?|&)returnUrl=https%3A%2F%2Fenke.to/
                },
                // test parentWindowOrigin
                {
                    method: 'post',
                    auth: true,
                    parentWindowOrigin: 'http://example.com',
                    ret: false,
                    instanceId: true,
                    instance: true,
                    status: 201,
                    expected: /.+(\?|&)parentWindowOrigin=http%3A%2F%2Fexample\.com/,
                },
                // invalid parameters
                {
                    method: 'post',
                    auth: true,
                    id: '',
                    instanceId: true,
                    instance: true,
                    status: 400
                }, {
                    method: 'post',
                    auth: true,
                    instance: '',
                    instanceId: true,
                    status: 400
                }, {
                    method: 'post',
                    auth: true,
                    instanceId: '',
                    instance: true,
                    status: 400
                }, {
                    method: 'post',
                    auth: true,
                    instanceId: true,
                    instance: true,
                    server: '',
                    status: 400
                }
            ].map( obj => {
                obj.version = version;
                obj.endpoint = '/instance/view';
                return obj;
            } ).forEach( testResponse );

            // Headless tests
            [ {
                // no instanceId
                method: 'post',
                endpoint: '/instance/headless',
                auth: true,
                instance: true,
                status: 400
            }, {
                // no instance
                method: 'post',
                endpoint: '/instance/headless',
                auth: true,
                instanceId: 'AAA',
                instance: false,
                status: 400
            }, {
                // no instanceId, RFC
                method: 'post',
                endpoint: '/instance/headless',
                auth: true,
                instance: true,
                status: 400
            }, {
                // no instance, RFC
                method: 'post',
                endpoint: '/instance/headless',
                auth: true,
                instanceId: 'AAA',
                instance: false,
                status: 400
            } ].map( obj => {
                obj.version = version;
                return obj;
            } ).forEach( testResponse );
        } );

        // Test common parameters
        // Some of tests are duplicates of earlier tests
        // Those earlier tests could be removed
        describe( 'common parameters', () => {

            const endpoints = [
                '/survey/collect',
                '/survey/collect/c',
                '/survey/view',
                '/instance/edit',
                '/instance/edit/c',
                '/instance/edit/rfc',
                '/instance/edit/rfc/c',
                '/instance/view',
                '/instance/note',
                '/instance/note/c',
            ];

            // parentWindowOrigin
            endpoints.concat( [ '/survey/preview', '/survey/collect/participant', '/instance/edit/participant' ] ).forEach( endpoint => {
                const obj = {
                    version,
                    auth: true,
                    method: 'post',
                    endpoint,
                    instanceId: true,
                    instance: true,
                    status: endpoint.startsWith( '/instance' ) ? 201 : 200,
                };
                obj.parentWindowOrigin = 'http://example.com';
                obj.expected = /.+(\?|&)parentWindowOrigin=http%3A%2F%2Fexample\.com/;
                testResponse( obj );
            } );

            // ecid
            const ecidEndpoints = endpoints.concat( [ '/survey/collect/participant', '/instance/edit/participant' ] );
            ecidEndpoints.forEach( endpoint => {
                const obj = {
                    version,
                    auth: true,
                    method: 'post',
                    endpoint,
                    instanceId: true,
                    instance: true,
                    status: endpoint.startsWith( '/instance' ) ? 201 : 200,
                };
                obj.ecid = 'abcd';
                obj.expected = /.+(\?|&)ecid=abcd/;
                testResponse( obj );
            } );
            ecidEndpoints.forEach( endpoint => {
                const obj = {
                    version,
                    auth: true,
                    method: 'post',
                    endpoint,
                    instanceId: true,
                    instance: true,
                    status: 400,
                };
                obj.ecid = '';
                testResponse( obj );
            } );

            // pid
            endpoints.forEach( endpoint => {
                const obj = {
                    version,
                    auth: true,
                    method: 'post',
                    endpoint,
                    instanceId: true,
                    instance: true,
                    status: endpoint.startsWith( '/instance' ) ? 201 : 200,
                };
                obj.pid = '123';
                obj.expected = /.+(\?|&)PID=123/;
                testResponse( obj );
            } );
            endpoints.forEach( endpoint => {
                const obj = {
                    version: 1,
                    auth: true,
                    method: 'post',
                    endpoint,
                    instanceId: true,
                    instance: true,
                    status: endpoint.startsWith( '/instance' ) ? 201 : 200,
                };
                obj.pid = ''; // is optional
                testResponse( obj );
            } );

            // previews, ignoring ecid and pid
            testResponse( {
                version,
                auth: true,
                method: 'post',
                endpoint: '/survey/preview',
                pid: 'a',
                ecid: 'b',
                status: 200,
                expected: /::[A-z0-9]+$/
            } );

            // jini
            [
                '/survey/collect',
                '/survey/collect/c',
                '/survey/preview',
                '/instance/edit',
                '/instance/edit/c',
                '/instance/edit/rfc',
                '/instance/edit/rfc/c',
            ].forEach( endpoint => {
                const obj = {
                    version: 1,
                    auth: true,
                    method: 'post',
                    endpoint,
                    instanceId: true,
                    instance: true,
                    status: endpoint.startsWith( '/instance' ) ? 201 : 200
                };
                obj.jini = 'true';
                obj.expected = /.+(\?|&)jini=true/;
                testResponse( obj );
            } );
        } );

    } );
} );
