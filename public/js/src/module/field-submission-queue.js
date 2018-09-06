'use strict';

var settings = require( './settings' );
var t = require( './translator' ).t;
var utils = require( './utils' );
var Promise = require( 'lie' );
var $ = require( 'jquery' );
var gui = require( './gui' );
var MD5 = require( 'crypto-js/md5' );
var FIELDSUBMISSION_URL = ( settings.enketoId ) ? settings.basePath + '/fieldsubmission/' + settings.enketoIdPrefix + settings.enketoId +
    utils.getQueryString( settings.submissionParameter ) : null;
var FIELDSUBMISSION_COMPLETE_URL = ( settings.enketoId ) ? settings.basePath + '/fieldsubmission/complete/' + settings.enketoIdPrefix + settings.enketoId +
    utils.getQueryString( settings.submissionParameter ) : null;

function FieldSubmissionQueue() {
    this.submissionQueue = {};
    this.lastAdded = {};
    this.repeatRemovalCounter = 0;
    this.submittedCounter = 0;
    this.queuedSubmitAllRequest = undefined;
    this._uploadStatus.init();
}

FieldSubmissionQueue.prototype.get = function() {
    return this.submissionQueue;
};

FieldSubmissionQueue.prototype.addFieldSubmission = function( fieldPath, xmlFragment, instanceId, deprecatedId, file ) {
    var fd;

    if ( this._duplicateCheck( fieldPath, xmlFragment ) ) {
        return;
    }

    fd = new FormData();

    if ( fieldPath && xmlFragment && instanceId ) {

        fd.append( 'instance_id', instanceId );
        fd.append( 'xml_submission_fragment_file', new Blob( [ xmlFragment ], {
            type: 'text/xml'
        } ), 'xml_submission_fragment_file.xml' );

        if ( file && file instanceof Blob ) {
            fd.append( file.name, file, file.name );
        }

        if ( deprecatedId ) {
            fd.append( 'deprecated_id', deprecatedId );
            // Overwrite if older value fieldsubmission in queue.
            this.submissionQueue[ 'PUT_' + fieldPath ] = fd;
        } else {
            this.submissionQueue[ 'POST_' + fieldPath ] = fd;
        }

    } else {
        console.error( 'Attempt to add field submission without path, XML fragment or instanceID' );
    }
};

FieldSubmissionQueue.prototype.addRepeatRemoval = function( xmlFragment, instanceId, deprecatedId ) {
    var fd;

    // No duplicate check necessary for deleting as the event should only fire once.

    fd = new FormData();
    if ( xmlFragment && instanceId ) {

        fd.append( 'xml_submission_fragment_file', new Blob( [ xmlFragment ], {
            type: 'text/xml'
        } ), 'xml_submission_fragment_file.xml' );

        fd.append( 'instance_id', instanceId );
        if ( deprecatedId ) {
            fd.append( 'deprecated_id', deprecatedId );
        }

        // Overwrite if older value fieldsubmission in queue.
        this.submissionQueue[ 'DELETE_' + this.repeatRemovalCounter++ ] = fd;
    } else {
        console.error( 'Attempt to add repeat removal without XML fragment or instanceID' );
    }
};

FieldSubmissionQueue.prototype.submitAll = function() {
    var that = this;
    if ( this.ongoingSubmissions ) {
        // store the successive request in a global variable (without executing it)
        this.queuedSubmitAllRequest = this._submitAll;
        this.ongoingSubmissions = this.ongoingSubmissions
            .then( function( result ) {
                var request;
                if ( that.queuedSubmitAllRequest ) {
                    request = that.queuedSubmitAllRequest();
                    /*
                     * Any subsequent submitAll requests that arrived while the first request 
                     * was ongoing have overwritten the that.queuedSubmitAllRequest variable.
                     * Only the last request received in this period is relevant.
                     *
                     * Before we execute the queued request we set the variable to undefined.
                     *
                     * This means that those subsequent requests will only be executed once. 
                     * Subsequent stacked request immediate return result.
                     * In other words, the stack of successive submitAll request will never 
                     * be larger than 2.
                     */
                    that.queuedSubmitAllRequest = undefined;
                    return request;
                }
                return result;
            } );
    } else {
        this.ongoingSubmissions = this._submitAll();
    }

    this.ongoingSubmissions
        .then( function() {
            that.ongoingSubmissions = undefined;
        } );

    return this.ongoingSubmissions;
};

FieldSubmissionQueue.prototype._submitAll = function() {
    var _queue;
    var method;
    var url;
    var status;
    var keyParts;
    var that = this;
    var authRequired;

    if ( Object.keys( this.submissionQueue ).length > 0 ) {

        this._uploadStatus.update( 'ongoing' );

        // convert fieldSubmissionQueue object to array of objects
        _queue = Object.keys( that.submissionQueue ).map( function( key ) {
            return {
                key: key,
                fd: that.submissionQueue[ key ]
            };
        } );

        // empty the fieldSubmission queue
        that.submissionQueue = {};

        // clear submissionInterval to avoid a never-ending loop of submissions if /fieldsubmission is failing
        that._clearSubmissionInterval();

        // submit sequentially
        return _queue.reduce( function( prevPromise, fieldSubmission ) {
                return prevPromise.then( function() {
                    keyParts = fieldSubmission.key.split( '_' );
                    method = keyParts[ 0 ];
                    url = FIELDSUBMISSION_URL;
                    return that._submitOne( url, fieldSubmission.fd, method )
                        .catch( function( error ) {
                            console.debug( 'failed to submit ', fieldSubmission.key, 'adding it back to the queue, error:', error );
                            // add back to the fieldSubmission queue if the field value wasn't overwritten in the mean time
                            if ( typeof that.submissionQueue[ fieldSubmission.key ] === 'undefined' ) {
                                that.submissionQueue[ fieldSubmission.key ] = fieldSubmission.fd;
                            }
                            if ( error.status === 401 ) {
                                authRequired = true;
                            }
                            return error;
                        } );
                } );
            }, Promise.resolve() )
            .then( function() {
                console.log( 'All done with queue submission. Current remaining queue is', that.submissionQueue );
                if ( authRequired ) {
                    gui.confirmLogin();
                }
            } )
            .catch( function( error ) {
                console.error( 'Unexpected error:', error.message );
            } )
            .then( function() {
                that._resetSubmissionInterval();
                status = Object.keys( that.submissionQueue ).length > 0 ? 'fail' : 'success';
                that._uploadStatus.update( status );
                return true;
            } );
    }
    return Promise.resolve();
};

FieldSubmissionQueue.prototype._submitOne = function( url, fd, method ) {
    var that = this;
    var error;

    return new Promise( function( resolve, reject ) {
        $.ajax( url, {
                type: method,
                data: fd,
                cache: false,
                contentType: false,
                processData: false,
                headers: {
                    'X-OpenClinica-Version': '1.0'
                },
                timeout: 3 * 60 * 1000
            } )
            .done( function( data, textStatus, jqXHR ) {
                if ( jqXHR.status === 201 || jqXHR.status === 202 ) {
                    that.submittedCounter = jqXHR.status === 201 ? that.submittedCounter + 1 : that.submittedCounter;
                    resolve( jqXHR.status );
                } else {
                    throw jqXHR;
                }
            } )
            .fail( function( jqXHR ) {
                error = new Error( jqXHR.statusText );
                error.status = jqXHR.status;
                if ( jqXHR.status === 409 ) {
                    that._showLockedMsg();
                }
                reject( error );
            } );
    } );
};

FieldSubmissionQueue.prototype.complete = function( instanceId, deprecatedId ) {
    var error;
    var method = 'POST';

    if ( Object.keys( this.submissionQueue ).length === 0 && instanceId ) {
        var fd = new FormData();
        fd.append( 'instance_id', instanceId );

        if ( deprecatedId ) {
            fd.append( 'deprecated_id', deprecatedId );
            method = 'PUT';
        }

        return this._submitOne( FIELDSUBMISSION_COMPLETE_URL, fd, method )
            .then( function() {
                return true;
            } );
    } else {
        error = new Error( 'Attempt to make a "complete" request when queue is not empty or instanceId is missing', this.submissionQueue, instanceId );
        console.error( error );
        return Promise.reject( error );
    }
};

FieldSubmissionQueue.prototype._resetSubmissionInterval = function() {
    var that = this;
    this._clearSubmissionInterval();
    this.submissionInterval = setInterval( function() {
        that.submitAll();
    }, 1 * 60 * 1000 );
};

FieldSubmissionQueue.prototype._clearSubmissionInterval = function() {
    clearInterval( this.submissionInterval );
};

FieldSubmissionQueue.prototype._showLockedMsg = function() {
    gui.alert( t( 'fieldsubmission.alert.locked.msg' ), t( 'fieldsubmission.alert.locked.heading' ) );
};

FieldSubmissionQueue.prototype._duplicateCheck = function( path, fragment ) {
    var hash = MD5( fragment ).toString();
    if ( this.lastAdded[ path ] !== hash ) {
        this.lastAdded[ path ] = hash;
        return false;
    }
    return true;
};

/**
 * Shows upload progress
 *
 * @type {Object}
 */
FieldSubmissionQueue.prototype._uploadStatus = {
    init: function() {
        if ( !this._$box ) {
            this._$box = $( '<div class="fieldsubmission-status"/>' ).prependTo( '.form-header' )
                .add( $( '<div class="form-footer__feedback fieldsubmission-status"/>' ).prependTo( '.form-footer' ) );
        }
    },
    _getBox: function() {
        return this._$box;
    },
    _getText: function( status ) {
        return {
            ongoing: t( 'fieldsubmission.feedback.ongoing' ),
            success: t( 'fieldsubmission.feedback.success' ),
            fail: t( 'fieldsubmission.feedback.fail' )
        }[ status ];
    },
    _updateClass: function( status ) {
        this._getBox().removeClass( 'ongoing success error fail' ).addClass( status ).text( this._getText( status ) );
    },
    update: function( status ) {
        if ( /\/fs\/dnc?\//.test( window.location.pathname ) ) {
            return;
        }
        this._updateClass( status );
    }
};

module.exports = FieldSubmissionQueue;
