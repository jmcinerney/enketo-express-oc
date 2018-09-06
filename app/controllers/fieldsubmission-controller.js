'use strict';

var communicator = require( '../lib/communicator' );
var surveyModel = require( '../models/survey-model' );
var userModel = require( '../models/user-model' );
var routerUtils = require( '../lib/router-utils' );
var request = require( 'request' );
var express = require( 'express' );
var router = express.Router();
// var debug = require( 'debug' )( 'fieldsubmission-controller' );

module.exports = function( app ) {
    app.use( app.get( 'base path' ) + '/fieldsubmission', router );
};

router.param( 'enketo_id', routerUtils.enketoId );
router.param( 'encrypted_enketo_id_view_dn', routerUtils.encryptedEnketoIdViewDn );
router.param( 'encrypted_enketo_id_view_dnc', routerUtils.encryptedEnketoIdViewDnc );
router.param( 'encrypted_enketo_id_fs_c', routerUtils.encryptedEnketoIdFsC );
router.param( 'encrypted_enketo_id_rfc', routerUtils.encryptedEnketoIdEditRfc );
router.param( 'encrypted_enketo_id_rfc_c', routerUtils.encryptedEnketoIdEditRfcC );
router.param( 'encrypted_enketo_id_headless', routerUtils.encryptedEnketoIdEditHeadless );

router
    .all( '*', function( req, res, next ) {
        res.set( 'Content-Type', 'application/json' );
        next();
    } )
    .post( '/:enketo_id', submit )
    .post( '/:encrypted_enketo_id_fs_c', submit )
    .post( '/complete/:enketo_id', complete )
    .post( '/complete/:encrypted_enketo_id_fs_c', complete )
    .put( '/:enketo_id', submit )
    .put( '/:encrypted_enketo_id_fs_c', submit )
    .put( '/:encrypted_enketo_id_view_dn', submit )
    .put( '/:encrypted_enketo_id_view_dnc', submit )
    .put( '/:encrypted_enketo_id_rfc', submit )
    .put( '/:encrypted_enketo_id_rfc_c', submit )
    .put( '/:encrypted_enketo_id_headless', submit )
    .put( '/complete/:enketo_id', complete )
    .put( '/complete/:encrypted_enketo_id_fs_c', complete )
    .put( '/complete/:encrypted_enketo_id_view_dn', complete )
    .put( '/complete/:encrypted_enketo_id_view_dnc', complete )
    .put( '/complete/:encrypted_enketo_id_rfc', complete )
    .put( '/complete/:encrypted_enketo_id_rfc_c', complete )
    .put( '/complete/:encrypted_enketo_id_headless', submit )
    .delete( '/:enketo_id', submit )
    .delete( '/:encrypted_enketo_id_fs_c', submit )
    .delete( '/:encrypted_enketo_id_rfc', submit )
    .delete( '/:encrypted_enketo_id_rfc_c', submit )
    .delete( '/:encrypted_enketo_id_headless', submit )
    .all( '/*', function( req, res, next ) {
        var error = new Error( 'Not allowed' );
        error.status = 405;
        next( error );
    } );

function complete( req, res, next ) {
    _request( 'complete', req, res, next );
}

function submit( req, res, next ) {
    _request( 'field', req, res, next );
}

/** 
 * Simply pipes well-formed request to the OpenRosa server and
 * copies the response received.
 *
 * @param  {[type]}   req  [description]
 * @param  {[type]}   res  [description]
 * @param  {Function} next [description]
 * @return {[type]}        [description]
 */
function _request( type, req, res, next ) {
    var credentials;
    var options;
    var submissionUrl;
    var paramName = req.app.get( 'query parameter to pass to submission' );
    var paramValue = req.query[ paramName ];
    var query = ( paramValue ) ? '?' + paramName + '=' + paramValue : '';
    var id = req.enketoId;

    surveyModel.get( id )
        .then( function( survey ) {
            submissionUrl = _getSubmissionUrl( survey.openRosaServer, type ) + query;
            credentials = userModel.getCredentials( req );
            return communicator.getAuthHeader( submissionUrl, credentials );
        } )
        .then( function( authHeader ) {
            options = {
                url: submissionUrl,
                headers: authHeader ? {
                    'Authorization': authHeader
                } : {},
                timeout: req.app.get( 'timeout' ) + 500
            };

            // pipe the request 
            req.pipe( request( options ) ).on( 'response', function( orResponse ) {
                if ( orResponse.statusCode === 201 ) {
                    // TODO: Do we really want to log all field submissions? It's a huge amount.
                    // _logSubmission( id, instanceId, deprecatedId );
                } else if ( orResponse.statusCode === 401 ) {
                    // replace the www-authenticate header to avoid browser built-in authentication dialog
                    orResponse.headers[ 'WWW-Authenticate' ] = 'enketo' + orResponse.headers[ 'WWW-Authenticate' ];
                }
            } ).pipe( res );

        } )
        .catch( next );
}

function _getSubmissionUrl( server, type ) {
    var lastPathPart = ( type === 'field' || !type ) ? '' : '/' + type;
    return ( server.lastIndexOf( '/' ) === server.length - 1 ) ? server + 'fieldsubmission' + lastPathPart : server + '/fieldsubmission' + lastPathPart;
}

/*
function _logSubmission( id, instanceId, deprecatedId ) {
    submissionModel.isNew( id, instanceId )
        .then( function( notRecorded ) {
            if ( notRecorded ) {
                // increment number of submissions
                surveyModel.incrementSubmissions( id );
                // store/log instanceId
                submissionModel.add( id, instanceId, deprecatedId );
            }
        } )
        .catch( function( error ) {
            console.error( error );
        } );
}
*/
