const utils = require( './utils' );
const config = require( '../models/config-model' ).server;
const keys = {
    singleOnce: config[ 'less secure encryption key' ],
    view: `${config[ 'less secure encryption key' ]}view`,
    viewDn: `${config[ 'less secure encryption key' ]}view-dn`,
    viewDnc: `${config[ 'less secure encryption key' ]}view-dnc`,
    fsC: `${config[ 'less secure encryption key' ]}fs-c`,
    fsParticipant: `${config[ 'less secure encryption key' ]}fs-participant`,
    editRfc: `${config[ 'less secure encryption key' ]}edit-rfc`,
    editRfcC: `${config[ 'less secure encryption key' ]}edit-rfc-c`,
    editHeadless: `${config[ 'less secure encryption key' ]}edit-headless`,
};

function enketoIdParam( req, res, next, id ) {
    if ( /^::[A-z0-9]{4,8}$/.test( id ) ) {
        req.enketoId = id.substring( 2 );
        next();
    } else {
        next( 'route' );
    }
}

function encryptedEnketoIdParamSingle( req, res, next, id ) {
    _encryptedEnketoIdParam( req, res, next, id, keys.singleOnce );
}

function encryptedEnketoIdParamView( req, res, next, id ) {
    _encryptedEnketoIdParam( req, res, next, id, keys.view );
}

function encryptedEnketoIdViewDn( req, res, next, id ) {
    _encryptedEnketoIdParam( req, res, next, id, keys.viewDn );
}

function encryptedEnketoIdViewDnc( req, res, next, id ) {
    _encryptedEnketoIdParam( req, res, next, id, keys.viewDnc );
}

function encryptedEnketoIdFsC( req, res, next, id ) {
    _encryptedEnketoIdParam( req, res, next, id, keys.fsC );
}

function encryptedEnketoIdFsParticipant( req, res, next, id ) {
    _encryptedEnketoIdParam( req, res, next, id, keys.fsParticipant );
}

function encryptedEnketoIdEditRfc( req, res, next, id ) {
    _encryptedEnketoIdParam( req, res, next, id, keys.editRfc );
}

function encryptedEnketoIdEditRfcC( req, res, next, id ) {
    _encryptedEnketoIdParam( req, res, next, id, keys.editRfcC );
}

function encryptedEnketoIdEditHeadless( req, res, next, id ) {
    _encryptedEnketoIdParam( req, res, next, id, keys.editHeadless );
}

function _encryptedEnketoIdParam( req, res, next, id, key ) {
    // either 32 or 64 hexadecimal characters
    if ( /^::([0-9a-fA-F]{32}$|[0-9a-fA-F]{64})$/.test( id ) ) {
        req.encryptedEnketoId = id.substring( 2 );
        try {
            // Just see if it can be decrypted. Storing the encrypted value might
            // increases chance of leaking underlying enketo_id but for now this is used
            // in the submission controller and transformation controller.
            const decrypted = utils.insecureAes192Decrypt( id.substring( 2 ), key );
            // Sometimes decryption by incorrect keys works and results in gobledigook.
            // A really terrible way of working around this is to check if the result is
            // alphanumeric (as Enketo IDs always are).
            if ( /^[a-z0-9]+$/i.test( decrypted ) ) {
                req.enketoId = decrypted;
                next();
            } else {
                console.error( `decryption with${key}worked but result is not alphanumeric, ignoring result:`, decrypted );
                next( 'route' );
            }
        } catch ( e ) {
            // console.error( 'Could not decrypt:', req.encryptedEnketoId );
            next( 'route' );
        }
    } else {
        next( 'route' );
    }
}

module.exports = {
    enketoId: enketoIdParam,
    idEncryptionKeys: keys,
    encryptedEnketoIdSingle: encryptedEnketoIdParamSingle,
    encryptedEnketoIdView: encryptedEnketoIdParamView,
    encryptedEnketoIdViewDn,
    encryptedEnketoIdViewDnc,
    encryptedEnketoIdFsC,
    encryptedEnketoIdEditRfc,
    encryptedEnketoIdEditRfcC,
    encryptedEnketoIdEditHeadless,
    encryptedEnketoIdFsParticipant
};
