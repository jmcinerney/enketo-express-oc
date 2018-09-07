/**
 * Deals with the main high level survey controls for the special online-only auto-fieldsubmission view.
 *
 * Field values are automatically submitted upon change to a special OpenClinica Field Submission API.
 */

'use strict';

var gui = require( './gui' );
var settings = require( './settings' );
var Form = require( 'enketo-core' );
var fileManager = require( './file-manager' );
var Promise = require( 'lie' );
var t = require( './translator' ).t;
var $ = require( 'jquery' );
var FieldSubmissionQueue = require( './field-submission-queue' );
var fieldSubmissionQueue;
var rc = require( './controller-webform' );
var reasons = require( './reasons' );
var DEFAULT_THANKS_URL = '/thanks';
var form;
var formSelector;
var $formprogress;
var ignoreBeforeUnload = false;

var formOptions = {
    printRelevantOnly: settings.printRelevantOnly
};

// Modify Enketo Core
require( './Form' );


function init( selector, data, loadWarnings ) {
    var advice;
    var loadErrors = [].concat( loadWarnings );

    formSelector = selector;
    $formprogress = $( '.form-progress' );

    return new Promise( function( resolve ) {
            var goToErrorLink = settings.goToErrorUrl ? '<a href="' + settings.goToErrorUrl + '">' + settings.goToErrorUrl + '</a>' : '';

            if ( data.instanceAttachments ) {
                fileManager.setInstanceAttachments( data.instanceAttachments );
            }

            form = new Form( formSelector, data, formOptions );

            if ( settings.hardCheckEnabled ) {
                form.hardCheckEnabled = true;
            }

            // Additional layer of security to disable submissions in readonly views.
            // Should not be necessary to do this.
            if ( settings.type !== 'view' ) {
                fieldSubmissionQueue = new FieldSubmissionQueue();
            } else {
                console.log( 'Fieldsubmissions disabled' );
                fieldSubmissionQueue = {
                    submitAll: function() { return Promise.resolve(); },
                    get: function() { return {}; }
                };
            }

            // set eventhandlers before initializing form
            _setEventHandlers( selector );

            // listen for "gotohidden.enketo" event and add error
            $( formSelector ).on( 'gotohidden.enketo', function( e ) {
                // In OC hidden go_to fields should show loadError except if go_to field is a disrepancy_note
                // as those are always hidden upon load.
                if ( !e.target.classList.contains( 'or-appearance-dn' ) ) {
                    var err = t( 'alert.goto.hidden' ) + ' ';
                    err = goToErrorLink ? [ err + t( 'alert.goto.msg2', {
                        miniform: goToErrorLink,
                        // switch off escaping
                        interpolation: {
                            escapeValue: false
                        }
                    } ) ] : [ err + t( 'alert.goto.msg1' ) ];
                    loadErrors.push( err );
                }
            } );

            loadErrors = loadErrors.concat( form.init() );

            // Remove loader. This will make the form visible.
            // In order to aggregate regular loadErrors and GoTo loaderrors,
            // this is placed in between form.init() and form.goTo().
            $( 'body > .main-loader' ).remove();

            // Check if record is marked complete
            if ( data.instanceStr && form.model.isMarkedComplete() ) {
                $( 'button#finish-form' ).remove();
                $( 'button.close-form-regular' ).removeClass( 'close-form-regular' ).addClass( 'close-form-complete' );
            }

            if ( settings.goTo && location.hash ) {
                // form.goTo returns an array of 1 error if it has error. We're using our special
                // knowledge of Enketo Core to replace this error
                var goToErrors = form.goTo( location.hash.substring( 1 ) );
                if ( goToErrors.length ) {
                    var replErr = t( 'alert.goto.notfound' ) + ' ';
                    goToErrors = goToErrorLink ? [ replErr + t( 'alert.goto.msg2', {
                        miniform: goToErrorLink,
                        // switch off escaping
                        interpolation: {
                            escapeValue: false
                        }
                    } ) ] : [ replErr + t( 'alert.goto.msg1' ) ];
                }
                loadErrors = loadErrors.concat( goToErrors );
            }

            if ( form.encryptionKey ) {
                loadErrors.unshift( '<strong>' + t( 'error.encryptionnotsupported' ) + '</strong>' );
            }

            rc.setLogoutLinkVisibility();

            if ( loadErrors.length > 0 ) {
                throw loadErrors;
            }

            resolve( form );
        } )
        .catch( function( error ) {
            if ( Array.isArray( error ) ) {
                loadErrors = error;
            } else {
                loadErrors.unshift( error.message || t( 'error.unknown' ) );
            }

            advice = ( data.instanceStr ) ? t( 'alert.loaderror.editadvice' ) : t( 'alert.loaderror.entryadvice' );
            gui.alertLoadErrors( loadErrors, advice );
        } )
        .then( function( form ) {
            if ( settings.headless ) {
                console.log( 'doing headless things' );
                var $result = $( '<div id="headless-result" style="position: fixed; background: pink; top: 0; left: 50%;"/>' );
                if ( loadErrors.length ) {
                    $result.append( '<span id="error">' + loadErrors[ 0 ] + '</span>' );
                    $( 'body' ).append( $result );
                    return form;
                }
                return _headlessCloseComplete()
                    .then( function( fieldsubmissions ) {
                        $result.append( '<span id="fieldsubmissions">' + fieldsubmissions + '</span>' );
                    } )
                    .catch( function( error ) {
                        $result.append( '<span id="error">' + error.message + '</span>' );
                    } )
                    .then( function() {
                        $( 'body' ).append( $result );
                        return form;
                    } );
            }
        } )
        .then( function( form ) {
            // OC will return even if there were errors.
            return form;
        } );
}

/**
 * Controller function to reset to a blank form. Checks whether all changes have been saved first
 * @param  {boolean=} confirmed Whether unsaved changes can be discarded and lost forever
 */
/*function _resetForm( confirmed ) {
    var message;
    var choices;

    if ( !confirmed && form.editStatus ) {
        message = t( 'confirm.save.msg' );
        gui.confirm( message, choices )
            .then(function(confirmed){
                _resetForm( true );
            });
    } else {
        //_setDraftStatus( false );
        form.resetView();
        ignoreBeforeUnload = false;
        form = new Form( formSelector, {
            modelStr: formData.modelStr,
            external: formData.external
        }, formOptions );
        form.init();
        form.view.$
            .trigger( 'formreset' );
    }
}*/

function _headlessCloseComplete() {
    return form.validate()
        .then( function( valid ) {
            var $invalid = $();
            if ( !valid ) {
                $invalid = form.view.$.find( '.invalid-relevant, .invalid-constraint, .invalid-required' );
                // Trigger auto-queries for relevant, constraint and required (handled in DN widget)
                _autoAddQueries( $invalid );
            }

            // Check if autoqueries have made everything valid already, otherwise try validating again.
            if ( $invalid.length ) {
                return form.validate();
            }
            return valid;
        } ).then( function( valid ) {
            if ( !valid || reasons.getInvalidFields().length ) {
                throw new Error( 'Could not create valid record using autoqueries' );
            }
            return fieldSubmissionQueue.submitAll();
        } ).then( function() {

            if ( Object.keys( fieldSubmissionQueue.get() ).length > 0 ) {
                throw new Error( 'Failed to submit fieldsubmissions' );
            }

            if ( !form.model.isMarkedComplete() ) {
                return fieldSubmissionQueue.complete( form.instanceID, form.deprecatedID );
            }
        } ).then( function() {
            return ( fieldSubmissionQueue.submittedCounter );
        } );
}


/**
 * Closes the form after checking that the queue is empty.
 *
 * TODO: I think this can probably be reorganized to avoid the bypassAutoQuery parameter. 
 * See the _closeCompleteRecord for example.
 * 
 * @return {Promise} [description]
 */
function _closeRegular( bypassAutoQuery ) {
    var msg = '';
    var tAlertCloseMsg = t( 'fieldsubmission.alert.close.msg1' );
    var tAlertCloseHeading = t( 'fieldsubmission.alert.close.heading1' );
    var authLink = '<a href="/login" target="_blank">' + t( 'here' ) + '</a>';
    var $violated = form.view.$.find( '.invalid-constraint' );

    // First check if any constraints have been violated and prompt option to generate automatic queries
    if ( !bypassAutoQuery && $violated.length ) {
        return gui.confirm( {
                heading: t( 'alert.default.heading' ),
                errorMsg: t( 'fieldsubmission.confirm.autoquery.msg1' ),
                msg: t( 'fieldsubmission.confirm.autoquery.msg2' )
            }, {
                posButton: t( 'fieldsubmission.confirm.autoquery.automatic' ),
                negButton: t( 'fieldsubmission.confirm.autoquery.manual' ),
            } )
            .then( function( confirmed ) {
                if ( confirmed ) {
                    _autoAddQueries( $violated );
                }
                return confirmed;
            } );
    }

    // Start with actually closing, but only proceed once the queue is emptied.
    gui.alert( tAlertCloseMsg + '<br/>' +
        '<div class="loader-animation-small" style="margin: 40px auto 0 auto;"/>', tAlertCloseHeading, 'bare' );

    return fieldSubmissionQueue.submitAll()
        .then( function() {
            if ( Object.keys( fieldSubmissionQueue.get() ).length > 0 ) {
                throw new Error( t( 'fieldsubmission.alert.close.msg2' ) );
            } else {
                // this event is used in communicating back to iframe parent window
                $( document ).trigger( 'close' );

                msg += t( 'alert.submissionsuccess.redirectmsg' );
                gui.alert( msg, t( 'alert.submissionsuccess.heading' ), 'success' );
                _redirect();
            }
        } )
        .catch( function( error ) {
            var errorMsg;
            error = error || {};

            console.error( 'close error', error );
            if ( error.status === 401 ) {
                errorMsg = t( 'alert.submissionerror.authrequiredmsg', {
                    here: authLink
                } );
                gui.alert( errorMsg, t( 'alert.submissionerror.heading' ) );
            } else {
                errorMsg = error.message || gui.getErrorResponseMsg( error.status );
                gui.confirm( {
                        heading: t( 'alert.default.heading' ),
                        errorMsg: errorMsg,
                        msg: t( 'fieldsubmission.confirm.leaveanyway.msg' )
                    }, {
                        posButton: t( 'confirm.default.negButton' ),
                        negButton: t( 'fieldsubmission.confirm.leaveanyway.button' )
                    } )
                    .then( function( confirmed ) {
                        if ( !confirmed ) {
                            $( document ).trigger( 'close' );
                            _redirect( 100 );
                        }
                    } );
            }

        } );
}

function _closeSimple() {
    var msg = '';
    var tAlertCloseMsg = t( 'fieldsubmission.alert.close.msg1' );
    var tAlertCloseHeading = t( 'fieldsubmission.alert.close.heading1' );
    var authLink = '<a href="/login" target="_blank">' + t( 'here' ) + '</a>';

    // Start with actually closing, but only proceed once the queue is emptied.
    gui.alert( tAlertCloseMsg + '<br/>' +
        '<div class="loader-animation-small" style="margin: 40px auto 0 auto;"/>', tAlertCloseHeading, 'bare' );

    return fieldSubmissionQueue.submitAll()
        .then( function() {
            if ( Object.keys( fieldSubmissionQueue.get() ).length > 0 ) {
                throw new Error( t( 'fieldsubmission.alert.close.msg2' ) );
            } else {
                // this event is used in communicating back to iframe parent window
                $( document ).trigger( 'close' );

                msg += t( 'alert.submissionsuccess.redirectmsg' );
                gui.alert( msg, t( 'alert.submissionsuccess.heading' ), 'success' );
                _redirect();
            }
        } )
        .catch( function( error ) {
            var errorMsg;
            error = error || {};

            console.error( 'close error', error );
            if ( error.status === 401 ) {
                errorMsg = t( 'alert.submissionerror.authrequiredmsg', {
                    here: authLink
                } );
                gui.alert( errorMsg, t( 'alert.submissionerror.heading' ) );
            } else {
                errorMsg = error.message || gui.getErrorResponseMsg( error.status );
                gui.confirm( {
                        heading: t( 'alert.default.heading' ),
                        errorMsg: errorMsg,
                        msg: t( 'fieldsubmission.confirm.leaveanyway.msg' )
                    }, {
                        posButton: t( 'confirm.default.negButton' ),
                        negButton: t( 'fieldsubmission.confirm.leaveanyway.button' )
                    } )
                    .then( function( confirmed ) {
                        if ( !confirmed ) {
                            $( document ).trigger( 'close' );
                            _redirect( 100 );
                        }
                    } );
            }
        } );
}

// This is conceptually a Complete function that has some pre-processing.
function _closeCompletedRecord() {
    var $violated;

    if ( !reasons.validate() ) {
        var firstInvalidInput = reasons.getFirstInvalidField();
        gui.alert( t( 'fieldsubmission.alert.reasonforchangevalidationerror.msg' ) );
        firstInvalidInput.scrollIntoView();
        firstInvalidInput.focus();
        return Promise.resolve( false );
    } else {
        reasons.clearAll();
    }

    return form.validate()
        .then( function( valid ) {
            if ( valid ) {
                // do not show confirmation dialog
                return _complete( true );
            } else if ( form.view.$.find( '.invalid-relevant' ).length ) {
                gui.alert( t( 'fieldsubmission.alert.relevantvalidationerror.msg' ) );
                return false;
            } else {
                $violated = form.view.$.find( '.invalid-constraint, .invalid-required' );
                // Note that unlike _close this also looks at .invalid-required.
                return gui.confirm( {
                        heading: t( 'alert.default.heading' ),
                        errorMsg: t( 'fieldsubmission.confirm.autoquery.msg1' ),
                        msg: t( 'fieldsubmission.confirm.autoquery.msg2' )
                    }, {
                        posButton: t( 'fieldsubmission.confirm.autoquery.automatic' ),
                        negButton: t( 'fieldsubmission.confirm.autoquery.manual' )
                    } )
                    .then( function( confirmed ) {
                        if ( !confirmed ) {
                            return false;
                        }
                        _autoAddQueries( $violated );
                        return _closeCompletedRecord();
                    } );
            }
        } );
}

function _closeParticipant() {
    return form.validate()
        .then( function( valid ) {
            if ( !valid ) {
                var strictViolations = form
                    .view.$
                    .find( '.invalid-required [oc-required-type="strict"], .invalid-constraint [oc-constraint-type="strict"]' )
                    .length;

                valid = strictViolations === 0;
            }
            if ( valid ) {
                return _closeSimple();
            }
            gui.alert( t( 'fieldsubmission.confirm.autoquery.msg1' ) );
        } );
}

function _redirect( msec ) {
    ignoreBeforeUnload = true;
    setTimeout( function() {
        location.href = decodeURIComponent( settings.returnUrl || DEFAULT_THANKS_URL );
    }, msec || 1200 );
}

/**
 * Finishes a submission
 *
 * TODO: I think this can probably be reorganized to avoid the bypassConfirmation parameter. 
 * See the _closeCompleteRecord for example.
 * 
 */
function _complete( bypassConfirmation ) {
    var beforeMsg;
    var authLink;
    var instanceId;
    var deprecatedId;
    var msg = '';

    // First check if any constraints have been violated and prompt option to generate automatic queries
    if ( !bypassConfirmation ) {
        return gui.confirm( {
            heading: t( 'fieldsubmission.confirm.complete.heading' ),
            msg: t( 'fieldsubmission.confirm.complete.msg' )
        } );
    }

    form.view.$.trigger( 'beforesave' );

    beforeMsg = t( 'alert.submission.redirectmsg' );
    authLink = '<a href="/login" target="_blank">' + t( 'here' ) + '</a>';

    gui.alert( beforeMsg +
        '<div class="loader-animation-small" style="margin: 40px auto 0 auto;"/>', t( 'alert.submission.msg' ), 'bare' );

    return fieldSubmissionQueue.submitAll()
        .then( function() {
            var queueLength = Object.keys( fieldSubmissionQueue.get() ).length;

            if ( queueLength === 0 ) {
                instanceId = form.instanceID;
                deprecatedId = form.deprecatedID;
                return fieldSubmissionQueue.complete( instanceId, deprecatedId );
            } else {
                throw new Error( t( 'fieldsubmission.alert.complete.msg' ) );
            }
        } )
        .then( function() {
            // this event is used in communicating back to iframe parent window
            $( document ).trigger( 'submissionsuccess' );

            msg += t( 'alert.submissionsuccess.redirectmsg' );
            gui.alert( msg, t( 'alert.submissionsuccess.heading' ), 'success' );
            _redirect();
        } )
        .catch( function( result ) {
            result = result || {};
            console.error( 'submission failed' );
            if ( result.status === 401 ) {
                msg = t( 'alert.submissionerror.authrequiredmsg', {
                    here: authLink
                } );
            } else {
                msg = result.message || gui.getErrorResponseMsg( result.status );
            }
            gui.alert( msg, t( 'alert.submissionerror.heading' ) );
        } );
}

/**
 * Triggers autoqueries. 
 * @param {*} $questions 
 */
function _autoAddQueries( $questions ) {
    $questions.trigger( 'addquery.oc' );
}

function _autoAddReasonQueries( $rfcInputs ) {
    $rfcInputs.val( t( 'widget.dn.autonoreason' ) ).trigger( 'change' );
}

function _doNotSubmit( fullPath ) {
    // no need to check on cloned radiobuttons, selects or textareas
    return !!form.view.$.get( 0 ).querySelector( 'input[oc-external="clinicaldata"][name="' + fullPath + '"]' );
}

function _setEventHandlers( selector ) {
    var $doc = $( document );
    $doc
        .on( 'progressupdate.enketo', selector, function( event, status ) {
            if ( $formprogress.length > 0 ) {
                $formprogress.css( 'width', status + '%' );
            }
        } )
        // After repeat removal from view (before removal from model)
        .on( 'removed.enketo', function( event, updated ) {
            var instanceId = form.instanceID;
            if ( !updated.xmlFragment ) {
                console.error( 'Could not submit repeat removal fieldsubmission. XML fragment missing.' );
                return;
            }
            if ( !instanceId ) {
                console.error( 'Could not submit repeat removal fieldsubmission. InstanceID missing' );
            }

            fieldSubmissionQueue.addRepeatRemoval( updated.xmlFragment, instanceId, form.deprecatedID );
            fieldSubmissionQueue.submitAll();
        } )
        // Field is changed
        .on( 'dataupdate.enketo', selector, function( event, updated ) {
            var instanceId = form.instanceID;
            var file;

            if ( updated.cloned ) {
                // This event is fired when a repeat is cloned. It does not trigger
                // a fieldsubmission.
                return;
            }
            if ( !updated.xmlFragment ) {
                console.error( 'Could not submit field. XML fragment missing. (If repeat was deleted, this is okay.)' );
                return;
            }
            if ( !instanceId ) {
                console.error( 'Could not submit field. InstanceID missing' );
                return;
            }
            if ( !updated.fullPath ) {
                console.error( 'Could not submit field. Path missing.' );
            }
            if ( _doNotSubmit( updated.fullPath ) ) {
                return;
            }
            if ( updated.file ) {
                file = fileManager.getCurrentFile( updated.file );
            }
            // Only now will we check for the deprecatedID value, which at this point should be (?) 
            // populated at the time the instanceID dataupdate event is processed and added to the fieldSubmission queue.
            fieldSubmissionQueue.addFieldSubmission( updated.fullPath, updated.xmlFragment, instanceId, form.deprecatedID, file );
            fieldSubmissionQueue.submitAll();

        } );

    // Before repeat removal from view and model
    if ( settings.reasonForChange ) {
        // We need to catch the click before repeat.js does. So 
        // we attach the handler to a lower level DOM element and make sure it's only attached once.
        $( '.or-repeat-info' ).parent( '.or-group, .or-group-data' ).on( 'click.propagate', 'button.remove:enabled', function( evt, data ) {
            if ( data && data.propagate ) {
                return true;
            }
            // Any form controls inside the repeat need a Reason for Change
            // TODO: exclude controls that have no value?
            var $questions = $( evt.currentTarget ).closest( '.or-repeat' ).find( '.question:not(.disabled)' );
            var texts = {
                heading: t( 'fieldsubmission.prompt.repeatdelete.heading' ),
                msg: t( 'fieldsubmission.prompt.repeatdelete.msg' ) + ' ' + t( 'fieldsubmission.prompt.reason.msg' )
            };
            var inputs = '<p><label><input name="reason" type="text"/></label></p>';

            gui.prompt( texts, {}, inputs )
                .then( function( values ) {
                    if ( !values ) {
                        return;
                    } else if ( !values.reason || !values.reason.trim() ) {
                        // TODO: something
                        return;
                    } else {
                        $questions.trigger( 'reasonchange.enketo', values );
                        // Propagate to repeat.js
                        $( evt.currentTarget ).trigger( 'click', {
                            propagate: true
                        } );
                        reasons.updateNumbering();
                    }
                } );

            return false;
        } );

        $( '.form-footer' ).find( '.next-page, .last-page, .previous-page, .first-page' ).on( 'click', function( evt ) {
            var valid = reasons.validate();
            if ( !valid ) {
                evt.stopImmediatePropagation();

                return false;
            }
            reasons.clearAll();
            return true;
        } );
    } else {
        // We need to catch the click before repeat.js does. So 
        // we attach the handler to a lower level DOM element and make sure it's only attached once.
        $( '.or-repeat-info' ).parent( '.or-group, .or-group-data' ).on( 'click.propagate', 'button.remove:enabled', function( evt, data ) {
            if ( data && data.propagate ) {
                return true;
            }
            var texts = {
                heading: t( 'fieldsubmission.prompt.repeatdelete.heading' ),
                msg: t( 'fieldsubmission.prompt.repeatdelete.msg' )
            };
            gui.confirm( texts )
                .then( function( confirmed ) {
                    if ( confirmed ) {
                        // Propagate to repeat.js
                        $( evt.currentTarget ).trigger( 'click', {
                            propagate: true
                        } );
                    }
                } );

            return false;
        } );
    }

    $( 'button#finish-form' ).click( function() {
        var $button = $( this ).btnBusyState( true );

        // form.validate() will trigger fieldsubmissions for timeEnd before it resolves
        form.validate()
            .then( function( valid ) {
                if ( valid ) {
                    return _complete()
                        .then( function( again ) {
                            if ( again ) {
                                return _complete( again );
                            }
                        } );
                } else {
                    if ( form.view.$.find( '.invalid-relevant' ).length ) {
                        gui.alert( t( 'fieldsubmission.alert.relevantvalidationerror.msg' ) );
                    } else {
                        gui.alert( t( 'fieldsubmission.alert.validationerror.msg' ) );
                    }
                }
            } )
            .catch( function( e ) {
                gui.alert( e.message );
            } )
            .then( function() {
                $button.btnBusyState( false );
            } );

        return false;
    } );

    $( 'button#close-form-regular' ).click( function() {
        var $button = $( this ).btnBusyState( true );

        _closeRegular()
            .then( function( again ) {
                if ( again ) {
                    return _closeRegular( true );
                }
            } )
            .catch( function( e ) {
                console.error( e );
            } )
            .then( function() {
                $button.btnBusyState( false );
            } );

        return false;
    } );

    // This is for closing a record that was marked as final. It's quite different
    // from Complete or the regular Close.
    $( 'button#close-form-complete' ).click( function() {
        var $button = $( this ).btnBusyState( true );

        // form.validate() will trigger fieldsubmissions for timeEnd before it resolves
        _closeCompletedRecord()
            .catch( function( e ) {
                gui.alert( e.message );
            } )
            .then( function() {
                $button.btnBusyState( false );
            } );

        return false;
    } );

    // This is for closing a record in a readonly or note-only view.
    $( 'button#close-form-read' ).click( function() {
        var $button = $( this ).btnBusyState( true );

        _closeSimple()
            .catch( function( e ) {
                gui.alert( e.message );
            } )
            .then( function() {
                $button.btnBusyState( false );
            } );

        return false;
    } );

    // This is for closing a participant view.
    $( 'button#close-form-participant' ).click( function() {
        var $button = $( this ).btnBusyState( true );

        _closeParticipant()
            .catch( function( e ) {
                gui.alert( e.message );
            } )
            .then( function() {
                $button.btnBusyState( false );
            } );

        return false;
    } );

    if ( rc.inIframe() && settings.parentWindowOrigin ) {
        $doc.on( 'submissionsuccess edited.enketo close', rc.postEventAsMessageToParentWindow );
    }

    window.onbeforeunload = function() {
        if ( !ignoreBeforeUnload ) {
            _autoAddQueries( form.view.$.find( '.invalid-constraint' ) );
            _autoAddReasonQueries( reasons.getInvalidFields() );
            if ( Object.keys( fieldSubmissionQueue.get() ).length > 0 ) {
                return 'Any unsaved data will be lost';
            }
        }
    };
}

module.exports = {
    init: init
};
