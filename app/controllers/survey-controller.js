const utils = require( '../lib/utils' );
const TError = require( '../lib/custom-error' ).TranslatedError;
const communicator = require( '../lib/communicator' );
const surveyModel = require( '../models/survey-model' );
const userModel = require( '../models/user-model' );
const config = require( '../models/config-model' ).server;
const express = require( 'express' );
const router = express.Router();
const routerUtils = require( '../lib/router-utils' );
// var debug = require( 'debug' )( 'survey-controller' );

module.exports = app => {
    app.use( `${app.get( 'base path' )}/`, router );
};

router.param( 'enketo_id', routerUtils.enketoId );
router.param( 'encrypted_enketo_id_single', routerUtils.encryptedEnketoIdSingle );
router.param( 'encrypted_enketo_id_view', routerUtils.encryptedEnketoIdView );
router.param( 'encrypted_enketo_id_view_dn', routerUtils.encryptedEnketoIdViewDn );
router.param( 'encrypted_enketo_id_view_dnc', routerUtils.encryptedEnketoIdViewDnc );
router.param( 'encrypted_enketo_id_fs_c', routerUtils.encryptedEnketoIdFsC );
router.param( 'encrypted_enketo_id_fs_participant', routerUtils.encryptedEnketoIdFsParticipant );
router.param( 'encrypted_enketo_id_rfc', routerUtils.encryptedEnketoIdEditRfc );
router.param( 'encrypted_enketo_id_rfc_c', routerUtils.encryptedEnketoIdEditRfcC );
router.param( 'encrypted_enketo_id_headless', routerUtils.encryptedEnketoIdEditHeadless );

router.param( 'mod', ( req, rex, next, mod ) => {
    if ( mod === 'i' ) {
        req.iframe = true;
        next();
    } else {
        req.iframe = false;
        next( 'route' );
    }
} );

router
    //.get( '*', loggedInCheck )
    .get( '*/participant/*', function( req, res, next ) {
        req.participant = true;
        next();
    } )
    .get( '/x/', offlineWebform )
    .get( '/_/', offlineWebform )
    .get( '*/headless*', _setHeadless )
    .get( '/preview*', _setJini )
    .get( /\/(single|edit)\/fs(\/rfc)?(\/c)?\/i/, _setJini )
    .get( /\/edit\/fs\/(?!(participant|rfc))/, _setCompleteButton )
    .get( '*', _setCloseButtonClass )
    .get( '/:enketo_id', webform )
    .get( '/:mod/:enketo_id', webform )
    .get( '/single/fs/:mod/:enketo_id', fieldSubmission )
    .get( '/single/fs/c/:mod/:encrypted_enketo_id_fs_c', fieldSubmission )
    .get( '/single/fs/participant/:mod/:encrypted_enketo_id_fs_participant', fieldSubmission )
    .get( '/preview/:enketo_id', preview )
    .get( '/preview/:mod/:enketo_id', preview )
    .get( '/preview', preview )
    .get( '/preview/:mod', preview )
    .get( '/single/:enketo_id', single )
    .get( '/single/:encrypted_enketo_id_single', single )
    .get( '/single/:mod/:enketo_id', single )
    .get( '/single/:mod/:encrypted_enketo_id_single', single )
    .get( '/view/:encrypted_enketo_id_view', view )
    .get( '/view/:mod/:encrypted_enketo_id_view', view )
    .get( '/edit/:enketo_id', edit )
    .get( '/edit/:mod/:enketo_id', edit )
    .get( '/edit/fs/rfc/:mod/:encrypted_enketo_id_rfc', fieldSubmission )
    .get( '/edit/fs/rfc/c/:mod/:encrypted_enketo_id_rfc_c', fieldSubmission )
    .get( '/edit/fs/:mod/:enketo_id', fieldSubmission )
    .get( '/edit/fs/c/:mod/:encrypted_enketo_id_fs_c', fieldSubmission )
    .get( '/edit/fs/dn/:mod/:encrypted_enketo_id_view_dn', fieldSubmission )
    .get( '/edit/fs/dn/c/:mod/:encrypted_enketo_id_view_dnc', fieldSubmission )
    .get( '/edit/fs/participant/:mod/:encrypted_enketo_id_fs_participant', fieldSubmission )
    .get( '/edit/fs/headless/:encrypted_enketo_id_headless', fieldSubmission )
    //.get( '/edit/fs/rfc/headless/:enketo_id_rfc', fieldSubmission )
    .get( '/view/fs/:encrypted_enketo_id_view', fieldSubmission )
    .get( '/view/fs/:mod/:encrypted_enketo_id_view', fieldSubmission )
    .get( '/xform/:enketo_id', xform )
    .get( '/xform/:encrypted_enketo_id_single', xform )
    .get( '/xform/:encrypted_enketo_id_view', xform )
    .get( '/xform/:encrypted_enketo_id_view_dn', xform )
    .get( '/xform/:encrypted_enketo_id_view_dnc', xform )
    .get( '/xform/:encrypted_enketo_id_fs_c', xform )
    .get( '/xform/:encrypted_enketo_id_fs_participant', xform )
    .get( '/connection', ( req, res ) => {
        res.status = 200;
        res.send( `connected ${Math.random()}` );
    } );

// TODO: I suspect this check is no longer used and can be removed
//function loggedInCheck( req, res, next ) {
//    req.logout = !!userModel.getCredentials( req );
//    next();
//}

function offlineWebform( req, res, next ) {
    if ( !req.app.get( 'offline enabled' ) ) {
        const error = new Error( 'Offline functionality has not been enabled for this application.' );
        error.status = 405;
        next( error );
    } else {
        req.manifest = `${req.app.get( 'base path' )}/x/manifest.appcache`;
        webform( req, res, next );
    }
}

function webform( req, res, next ) {
    const options = {
        manifest: req.manifest,
        iframe: req.iframe,
        print: req.query.print === 'true'
    };

    _renderWebform( req, res, next, options );
}

function single( req, res, next ) {
    const options = {
        type: 'single',
        iframe: req.iframe
    };
    if ( req.encryptedEnketoId && req.cookies[ req.encryptedEnketoId ] ) {
        res.redirect( `/thanks?taken=${req.cookies[ req.encryptedEnketoId ]}` );
    } else {
        _renderWebform( req, res, next, options );
    }
}

function _setJini( req, res, next ) {
    req.jini = req.query.jini === 'true' && config.jini[ 'style url' ] && config.jini[ 'script url' ] ? config.jini : null;
    next();
}

function _setCompleteButton( req, res, next ) {
    req.completeButton = true;
    next();
}

function _setCloseButtonClass( req, res, next ) {
    if ( /\/(view|dn)\//.test( req.originalUrl ) ) {
        req.closeButtonIdSuffix = 'read';
    } else if ( /participant/.test( req.originalUrl ) ) {
        req.closeButtonIdSuffix = 'participant';
    } else {
        req.closeButtonIdSuffix = 'regular';
    }
    next();
}

function _setHeadless( req, res, next ) {
    req.headless = true;
    next();
}

function fieldSubmission( req, res, next ) {
    var options = {
        type: 'fs',
        iframe: req.iframe,
        print: req.query.print === 'true',
        jini: req.jini,
        participant: req.participant,
        completeButton: req.completeButton,
        closeButtonIdSuffix: req.closeButtonIdSuffix,
        headless: !!req.headless
    };

    _renderWebform( req, res, next, options );
}

function view( req, res, next ) {
    const options = {
        type: 'view',
        iframe: req.iframe,
        print: req.query.print === 'true'
    };

    _renderWebform( req, res, next, options );
}

function preview( req, res, next ) {
    const options = {
        type: 'preview',
        jini: req.jini,
        iframe: req.iframe || !!req.query.iframe,
        notification: utils.pickRandomItemFromArray( config.notifications )
    };

    _renderWebform( req, res, next, options );
}

function edit( req, res, next ) {
    const options = {
        type: 'edit',
        iframe: req.iframe,
    };

    if ( req.query.instance_id ) {
        _renderWebform( req, res, next, options );
    } else {
        const error = new TError( 'error.invalidediturl' );
        error.status = 400;
        next( error );
    }
}

function _renderWebform( req, res, next, options ) {
    const deviceId = req.signedCookies[ '__enketo_meta_deviceid' ] || `${req.hostname}:${utils.randomString( 16 )}`,
        cookieOptions = {
            signed: true,
            maxAge: 10 * 365 * 24 * 60 * 60 * 1000
        };

    res
        .cookie( '__enketo_meta_deviceid', deviceId, cookieOptions )
        .render( 'surveys/webform', options );
}

/**
 * Debugging view that shows underlying XForm
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}        [description]
 */
function xform( req, res, next ) {
    return surveyModel.get( req.enketoId )
        .then( survey => {
            survey.credentials = userModel.getCredentials( req );
            return survey;
        } )
        .then( communicator.getXFormInfo )
        .then( communicator.getXForm )
        .then( survey => {
            res
                .set( 'Content-Type', 'text/xml' )
                .send( survey.xform );
        } )
        .catch( next );
}
