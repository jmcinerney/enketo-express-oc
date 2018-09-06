'use strict';

var Widget = require( 'enketo-core/src/js/Widget' );
var $ = require( 'jquery' );
var t = require( '../../public/js/src/module/translator' ).t;
var settings = require( '../../public/js/src/module/settings' );
var usersOptionsHtml;
var currentUser;
var users;
var SYSTEM_USER = 'root';
var reasons = require( '../../public/js/src/module/reasons' );

var pad2 = function( x ) {
    return ( x < 10 ) ? '0' + x : x;
};

/**
 * Visually transforms a question into a comment modal that can be shown on its linked question.
 *
 * @constructor
 * @param {Element}                       element   Element to apply widget to.
 * @param {(boolean|{touch: boolean})}    options   options
 * @param {*=}                            event     event
 */
function Comment( element, options, event, pluginName ) {
    this.namespace = pluginName;
    Widget.call( this, element, options );
    this._init();
}

Comment.prototype = Object.create( Widget.prototype );
Comment.prototype.constructor = Comment;

Comment.prototype._init = function() {
    this.$linkedQuestion = this._getLinkedQuestion( this.element );

    if ( this.$linkedQuestion.length === 1 ) {
        this.$commentQuestion = $( this.element ).closest( '.question' );
        this.ordinal = 0;
        this.readOnly = this.element.readOnly;

        this.linkedQuestionReadonly = this.$linkedQuestion[ 0 ]
            .querySelector( 'input:not(.ignore), textarea:not(.ignore), select:not(.ignore)' ).readOnly;
        this.notes = this._parseModelFromString( this.element.value );
        this.defaultAssignee = this._getDefaultAssignee( this.notes );
        this.$commentQuestion.addClass( 'hide' ).attr( 'role', 'comment' );
        // Any <button> inside a <label> receives click events if the <label> is clicked!
        // See http://codepen.io/MartijnR/pen/rWJeOG?editors=1111
        this.$commentButton = $( '<a class="btn-icon-only btn-comment btn-dn" tabindex="-1" type="button" href="#"><i class="icon"> </i></a>' );
        this._setCommentButtonState( this.element.value, '', this._getCurrentStatus( this.notes ) );
        this.$linkedQuestion.find( '.question-label' ).last().after( this.$commentButton );
        this._setUserOptions( this.readOnly );
        this._setCommentButtonHandler();
        this._setValidationHandler();
        this._setDisabledHandler();
        this._setValueChangeHandler();
        this._setCloseHandler();
        this._setFocusHandler();
        this._setConstraintEvaluationHandler();
        this._setRepeatRemovalReasonChangeHandler();
        this._setPrintOptimizationHandler();
    }
};

/**
 * This function should only be called by init (upon load).
 * @return {string} [description]
 */
Comment.prototype._getDefaultAssignee = function( notes ) {
    var defaultAssignee = '';

    notes.queries.concat( notes.logs ).sort( this._datetimeDesc.bind( this ) ).some( function( item ) {
        if ( item.user === SYSTEM_USER ) {
            return false;
        }
        defaultAssignee = item.user || '';
        return true;
    } );

    return defaultAssignee;
};

Comment.prototype._getLinkedQuestion = function( element ) {
    var $input = $( element );
    var contextPath = this.options.helpers.input.getName( $input );
    var targetPath = element.dataset.for.trim();
    var absoluteTargetPath = this.options.helpers.pathToAbsolute( targetPath, contextPath );
    // The root is nearest repeat or otherwise nearest form. This avoids having to calculate indices, without
    // diminishing the flexibility in any meaningful way, 
    // as it e.g. wouldn't make sense to place a comment node for a top-level question, inside a repeat.
    var $root = $( element ).closest( 'form.or, .or-repeat' );

    return this.options.helpers.input
        .getWrapNodes( $root.find( '[name="' + absoluteTargetPath + '"], [data-name="' + absoluteTargetPath + '"]' ) )
        .eq( 0 );
};

Comment.prototype._setCommentButtonState = function( value, error, state ) {
    this.$commentButton
        .toggleClass( 'new', state === 'new' )
        .toggleClass( 'closed', state === 'closed' )
        .toggleClass( 'closed-modified', state === 'closed-modified' )
        .toggleClass( 'updated', state === 'updated' )
        .toggleClass( 'invalid', !!error );
};

Comment.prototype._commentHasError = function() {
    return this.$commentQuestion.hasClass( 'invalid-required' ) || this.$commentQuestion.hasClass( 'invalid-constraint' );
};

Comment.prototype._setCommentButtonHandler = function() {
    var that = this;
    this.$commentButton.click( function() {
        if ( that._isCommentModalShown( that.$linkedQuestion ) ) {
            that._hideCommentModal( that.$linkedQuestion );
        } else {
            var errorMsg = that._getCurrentErrorMsg();
            that._showCommentModal( errorMsg );
        }
        return false;
    } );
};

Comment.prototype._setValidationHandler = function() {
    var that = this;

    // Update query icon if query question is invalid.
    this.$commentQuestion.on( 'invalidated.enketo', function() {
        that._setCommentButtonState( that.element.value, true );
    } );
};

Comment.prototype._setPrintOptimizationHandler = function() {
    this.$commentQuestion
        .on( 'printify.enketo', this._printify.bind( this ) )
        .on( 'deprintify.enketo', this._deprintify.bind( this ) );
};

Comment.prototype._setCloseHandler = function() {
    var that = this;

    this.$linkedQuestion.on( 'addquery.oc', function() {
        var currentStatus = that._getCurrentStatus( that.notes );
        var errorType = this.classList.contains( 'invalid-constraint' ) ? 'constraint' : ( this.classList.contains( 'invalid-required' ) ? 'required' : ( this.classList.contains( 'invalid-relevant' ) ? 'relevant' : null ) );
        if ( errorType && currentStatus !== 'updated' && currentStatus !== 'new' ) {
            var status = ( currentStatus === '' ) ? 'new' : 'updated';
            var errorMsg = $( this ).find( '.or-' + errorType + '-msg.active' ).text();
            that._addQuery( t( 'widget.dn.autoconstraint', {
                errorMsg: errorMsg
            } ), status, '', false, SYSTEM_USER );
        }
    } );
};

Comment.prototype._setFocusHandler = function() {
    var that = this;
    $( this.element ).on( 'applyfocus', function() {
        if ( that.$commentButton.is( ':visible' ) ) {
            that.$commentButton.click();
        } else {
            throw new Error( t( 'alert.gotohidden.msg' ) );
        }
    } );
};

/**
 * Observes the disabled state of the linked question, and automatically generates
 * an audit log if:
 * 1. The question gets disabled and the query is currently 'open'.
 */
Comment.prototype._setDisabledHandler = function() {
    var comment;
    var status;
    var currentStatus;
    var linkedVal;
    var open;
    var that = this;
    var target = this.$linkedQuestion.get( 0 ).querySelector( 'input, select, textarea' );
    var $target = $( target );

    this.$linkedQuestion.on( 'hiding.oc', function() {
        // For now there is no need to doublecheck if this question has a relevant attribute 
        // or has an ancestor group with a relevant attribute. This is because we trust that
        // the "hiding.oc" event is sent only for branches or its children when being closed (by the branch module).
        currentStatus = that._getCurrentStatus( that.notes );
        open = currentStatus === 'updated' || currentStatus === 'new';
        linkedVal = that.options.helpers.input.getVal( $target );
        // Note that getVal() can return an empty array.
        if ( open && linkedVal.length === 0 ) {
            // This will not be triggered if a form is loaded with a value for an irrelevant question and an open query.
            comment = t( 'widget.dn.autoclosed' );
            status = 'closed';
        }
        if ( comment ) {
            that._addQuery( comment, status, '', false, SYSTEM_USER );
        }
    } );
};

/**
 * Listens to a value change of the linked question and generates an audit log (and optionally a query).
 */
Comment.prototype._setValueChangeHandler = function() {
    var that = this;
    var previousValue = this.options.helpers.getModelValue( $( this.$linkedQuestion.get( 0 ).querySelector( 'input, select, textarea' ) ) );

    this.$linkedQuestion.on( 'valuechange.enketo inputupdate.enketo', function( evt ) {
        var comment;
        var currentValue = that.options.helpers.getModelValue( $( evt.target ) );
        var currentStatus = that._getCurrentStatus( that.notes );
        // Note obtaining the values like this does not work for file input types, but since have a different
        // change comment for those that doesn't mention the filename, we don't need to fix that.

        if ( evt.target.type !== 'file' ) {
            comment = t( 'widget.dn.valuechange', {
                'new': '"' + currentValue + '"',
                'previous': '"' + previousValue + '"'
            } );
        } else {
            comment = currentValue ? t( 'widget.dn.newfile' ) : t( 'widget.dn.fileremoved' );
        }

        that._addAudit( comment, '', false );

        if ( settings.reasonForChange && !that.linkedQuestionReadonly ) {
            reasons.addField( that.$linkedQuestion[ 0 ] )
                .on( 'change', function( evt ) {
                    // Also for empty onchange values
                    // TODO: exclude empty values if RFC field never had a value?
                    that._addReason( evt.target.value );
                    reasons.setSubmitted( evt.target );
                } )
                .on( 'input', function( evt ) {
                    if ( evt.target.value && evt.target.value.trim() ) {
                        reasons.setEdited( evt.target );
                    }
                } );

            reasons.applyToAll();
        }

        previousValue = currentValue;

        if ( currentStatus === 'closed' ) {
            comment = t( 'widget.dn.closedmodified' );
            that._addQuery( comment, 'closed-modified', '', false, SYSTEM_USER );
        }
    } );
};

Comment.prototype._setRepeatRemovalReasonChangeHandler = function() {
    var that = this;
    if ( settings.reasonForChange && !that.linkedQuestionReadonly ) {
        this.$linkedQuestion.on( 'reasonchange.enketo', function( evt, data ) {
            if ( data.reason ) {
                that._addReason( data.reason );
                reasons.removeField( this );
            } else {
                console.error( 'no reason provided' );
            }
        } );
    }
};

/**
 * Listen for a custom constraintevaluated.oc event in order to create a query if the status is closed.
 * 
 * This listener is meant for the following situation:
 * 1. a form is loaded with a query for question A with status 'closed' and a constraint that has a dependency on question B
 * 2. the value of question B is changed, triggering a re-evaluation of the constraint of question A
 * 3. regardless of the constraint evaluation result, this should add an autoquery to A and change the status to closed-modified
 */
Comment.prototype._setConstraintEvaluationHandler = function() {
    var that = this;
    this.$linkedQuestion.on( 'constraintevaluated.oc', function( event, updated ) {
        var comment;
        var currentStatus = that._getCurrentStatus( that.notes );
        /*
         * If during a session a query is closed, and this triggers a contraintUpdate of the linked question,
         * we do not want to generate an autoquery.
         * 
         * updated.fullPath includes positions (of repeats) which we need to strip
         */
        if ( currentStatus === 'closed' && updated.fullPath.replace( /\[\d+\]/g, '' ) !== that.element.getAttribute( 'name' ) ) {
            comment = t( 'widget.dn.closedmodified' );
            that._addQuery( comment, 'closed-modified', '', false, SYSTEM_USER );
        }
    } );
};

Comment.prototype._isCommentModalShown = function( $linkedQuestion ) {
    return $linkedQuestion.find( '.or-comment-widget' ).length === 1;
};

/**
 * If the linked question is not shown full width, ensure that the comment question is.
 * This correction is meant for the Grid Theme.
 * 
 */
Comment.prototype._getFullWidthStyleCorrection = function() {
    var $form = this.$linkedQuestion.closest( 'form' );
    var fullWidth = this.$linkedQuestion.closest( '.or-repeat' ).width() || $form.width();
    // select the first question on the current page
    var firstQuestionOnCurrentPage = $form[ 0 ].querySelector( '[role="page"].current.question, [role="page"].current .question' ) || $form[ 0 ].querySelector( '.question' );
    var mostLeft = $( firstQuestionOnCurrentPage ).position().left;
    var linkedQuestionWidth = this.$linkedQuestion.outerWidth();
    var linkedQuestionLeft = this.$linkedQuestion.position().left;

    // By correcting the left we can make this function agnostic to themes.
    return {
        width: ( fullWidth * 100 / linkedQuestionWidth ) + '%',
        left: ( ( mostLeft - linkedQuestionLeft ) * 100 / linkedQuestionWidth ) + '%'
    };
};

Comment.prototype._showCommentModal = function( linkedQuestionErrorMsg ) {
    var $widget;
    var $content;
    var $assignee;
    var $notify;
    var $user;
    var $input;
    var $overlay;
    var that = this;
    var $queryButtons = $( '<div class="or-comment-widget__content__query-btns">' );
    var $comment = $( this.element ).closest( '.question' ).clone( false );
    var noClose = settings.dnCloseButton !== true;
    var submitText = t( 'formfooter.submit.btn' ) || 'Submit';
    var updateText = t( 'widget.comment.update' ) || 'Update';
    var closeText = t( 'widget.dn.closeQueryText' ) || 'Close Query';
    var assignText = t( 'widget.dn.assignto' ) || 'Assign To'; // TODO: add string to kobotoolbox/enketo-express
    var notifyText = t( 'widget.dn.notifyText' ) || 'Email?'; // TODO: add string to kobotoolbox/enketo-express
    var $closeButton = $( '<button class="btn-icon-only or-comment-widget__content__btn-close-x" type="button">&times;</button>' );
    var $newQueryButton = $( '<button name="new" class="btn btn-primary or-comment-widget__content__btn-submit" type="button">' +
        submitText + '</button>' );
    var $updateQueryButton = $( '<button name="updated" class="btn btn-primary or-comment-widget__content__btn-submit" type="button">' +
        updateText + '</button>' );
    var $closeQueryButton = ( noClose ) ? $() : $( '<button name="closed" class="btn btn-default or-comment-widget__content__btn-submit" type="button">' +
        closeText + '</button>' );
    var status = this._getCurrentStatus( this.notes );
    var readOnlyAttr = this.readOnly ? 'readonly ' : '';

    if ( status === 'new' || status === 'updated' || status === 'closed-modified' ) {
        $queryButtons.append( $updateQueryButton ).append( $closeQueryButton );
    } else if ( status === 'closed' ) {
        $queryButtons.append( $updateQueryButton );
    } else {
        $queryButtons.append( $newQueryButton );
    }

    $input = $comment
        .removeClass( 'hide' )
        .removeAttr( 'role' )
        .find( 'input, textarea' )
        .addClass( 'ignore' )
        .removeAttr( 'name data-for data-type-xml' )
        .attr( 'name', 'dn-comment' )
        .removeData()
        .val( linkedQuestionErrorMsg );

    $overlay = $( '<div class="or-comment-widget__overlay"></div>' );
    $assignee = $( '<label class="or-comment-widget__content__user__dn-assignee"><span>' + assignText +
        '</span><select name="dn-assignee" class="ignore" >' + usersOptionsHtml + '</select>' );
    $notify = $( '<div class="or-comment-widget__content__user__dn-notify option-wrapper"><label><input name="dn-notify" ' +
        'class="ignore" value="true" type="checkbox" ' + readOnlyAttr + '/><span class="option-label">' + notifyText + '</span></label></div>' );
    this.$history = $( '<div class="or-comment-widget__content__history closed"><p></p><table></table></div>' );
    $user = $( '<div class="or-comment-widget__content__user">' ).append( $assignee ).append( $notify );

    $content = $( '<form onsubmit="return false;" class="or-comment-widget__content" autocomplete="off"></form>' )
        .append( $comment )
        .append( $user )
        .append( $closeButton )
        .append( $queryButtons )
        .append( this.$history );

    $widget = $(
        '<section class="widget or-comment-widget"></section>'
    ).append( $overlay ).append( $content ).css( this._getFullWidthStyleCorrection() );

    this.$linkedQuestion
        .find( '.or-comment-widget' ).remove().end()
        .prepend( $widget )
        .before( $overlay.clone( false ) );

    this._renderHistory();

    $input
        .on( 'input', function() {
            $queryButtons.find( '.btn' ).prop( 'disabled', !$input.val().trim() );
        } )
        .trigger( 'input' )
        .focus();

    $widget
        .find( 'form.or-comment-widget__content' ).on( 'submit', function() {
            $updateQueryButton.add( $newQueryButton ).click();
        } ).end()
        .get( 0 ).scrollIntoView( false );

    $queryButtons.find( '.btn' ).on( 'click', function() {
        if ( $input.val() ) {
            var comment = $input.val();
            var status = this.getAttribute( 'name' );
            var assignee = $assignee.find( 'select' ).val();
            var notify = $notify.find( 'input:checked' ).val() === 'true';
            that._addQuery( comment, status, assignee, notify );
            $input.val( '' );
            that._hideCommentModal( that.$linkedQuestion );
        }

        return false;
    } );

    $closeButton.add( $overlay ).on( 'click', function() {
        that._hideCommentModal( that.$linkedQuestion );
        return false;
    } );
};

Comment.prototype._hideCommentModal = function( $linkedQuestion ) {
    $linkedQuestion
        .find( '.or-comment-widget' ).remove().end()
        .prev( '.or-comment-widget__overlay' ).remove();
};

/**
 * Sets users, currentUser, and usersOptionsHtml global variables (once for all dn widgets);
 * 
 * @param {boolean=} readOnly 
 */
Comment.prototype._setUserOptions = function( readOnly ) {
    if ( !usersOptionsHtml ) {
        var disabled = readOnly ? 'disabled' : '';
        var defaultAssignee = this.defaultAssignee;
        try {
            var userNodes = this.options.helpers.evaluate( 'instance("_users")/root/item', 'nodes', null, null, true );

            // doing this in 2 steps as it is likely useful later on to store the users array separately.
            users = userNodes.map( function( item ) {
                return {
                    firstName: item.querySelector( 'first_name' ).textContent,
                    lastName: item.querySelector( 'last_name' ).textContent,
                    userName: item.querySelector( 'user_name' ).textContent
                };
            } );
            usersOptionsHtml = '<option value="" ' + disabled + '></option>' +
                users.map( function( user ) {
                    var readableName = user.firstName + ' ' + user.lastName + ' (' + user.userName + ')';
                    var selected = user.userName === defaultAssignee ? ' selected ' : '';
                    return '<option value="' + user.userName + '"' + selected + disabled + '>' + readableName + '</option>';
                } );

            var currentUsernameNode = this.options.helpers.evaluate( 'instance("_users")/root/item[@current]/user_name', 'node', null, null, true );
            currentUser = currentUsernameNode ? currentUsernameNode.textContent : null;
        } catch ( e ) {
            //users = [];
            console.error( e );
        }
    }
};

Comment.prototype._getCurrentErrorMsg = function() {
    if ( this.$linkedQuestion.hasClass( 'invalid-required' ) ) {
        return this.$linkedQuestion.find( '.or-required-msg.active' ).text();
    } else if ( this.$linkedQuestion.hasClass( 'invalid-constraint' ) ) {
        return this.$linkedQuestion.find( '.or-constraint-msg.active' ).text();
    } else {
        return '';
    }
};

Comment.prototype._parseModelFromString = function( str ) {
    try {
        if ( str.trim().length > 0 ) {
            var model = JSON.parse( str );
            if ( typeof model !== 'object' || Array.isArray( model ) ) {
                throw new Error( 'Parsed JSON is not an object.' );
            }
            if ( typeof model.queries === 'undefined' ) {
                model.queries = [];
            }
            if ( typeof model.logs === 'undefined' ) {
                model.logs = [];
            }
            return model;
        } else {
            return {
                queries: [],
                logs: []
            };
        }
    } catch ( e ) {
        console.error( e );
        throw new Error( 'Failed to parse discrepancy notes.' );
    }
};

Comment.prototype._datetimeDesc = function( a, b ) {
    var aDate = new Date( this._getIsoDatetimeStr( a.date_time ) );
    var bDate = new Date( this._getIsoDatetimeStr( b.date_time ) );
    if ( bDate.toString() === 'Invalid Date' || aDate > bDate ) {
        return -1;
    }
    if ( aDate.toString() === 'Invalid Date' || aDate < bDate ) {
        return 1;
    }
    return 0;
};

Comment.prototype._getParsedElapsedTime = function( datetimeStr ) {
    var dt = new Date( this._getIsoDatetimeStr( datetimeStr ) );
    if ( typeof datetimeStr !== 'string' || dt.toString() === 'Invalid Date' ) {
        console.error( 'Could not convert datetime string "' + datetimeStr + '" to a Date object.' );
        return 'error';
    }
    return this._parseElapsedTime( new Date() - dt );
};

Comment.prototype._getReadableDateTime = function( datetimeStr ) {
    var dt = new Date( this._getIsoDatetimeStr( datetimeStr ) );
    if ( typeof datetimeStr !== 'string' || dt.toString() === 'Invalid Date' ) {
        console.error( 'Could not convert datetime string "' + datetimeStr + '" to a Date object.' );
        return 'error';
    }
    // 13-Jun-2018 13:58 UTC-04:00
    return pad2( dt.getDate() ) + '-' + dt.toLocaleDateString( 'en', { month: 'short' } ) + '-' + dt.getFullYear() +
        ' ' + pad2( dt.getHours() ) + ':' + pad2( dt.getMinutes() ) + ' UTC' + dt.getTimezoneOffsetAsTime();
    // Date.getTimezoneOffsetAsTime is an extension in enketo-xpathjs
};

Comment.prototype._parseElapsedTime = function( elapsedMilliseconds ) {
    var months;
    var days;
    var hours;
    var minutes;

    if ( isNaN( elapsedMilliseconds ) || elapsedMilliseconds < -120000 ) {
        console.error( 'Could not parse elapsed time for elapsed milliseconds: "' + elapsedMilliseconds + '"' );
        return 'error';
    }

    // To work around negative values due to incorrect times on OC server or client device,
    // we tolerate up to -2 minutes.
    if ( elapsedMilliseconds < 0 ) {
        console.error( 'Negative time difference of less than 2 minutes. Setting to "Just Now"' );
        elapsedMilliseconds = 1;
    }

    minutes = elapsedMilliseconds / ( 1000 * 60 );
    // TODO: translateable strings with plural?
    if ( minutes < 0.5 ) {
        return t( 'widget.dn.zerominutes' ) || 'Just now';
    }
    if ( minutes < 59.5 ) {
        return Math.round( minutes ) + ' minute(s)';
    }
    hours = minutes / 60;
    if ( hours < 23.5 ) {
        return Math.round( hours ) + ' hour(s)';
    }
    days = hours / 24;
    if ( days < ( 5 / 12 + 30 - 0.5 ) ) {
        return Math.round( days ) + ' day(s)';
    }
    months = days / ( 5 / 12 + 30 );
    if ( months < 11.5 ) {
        return Math.round( months ) + ' month(s)';
    }
    return Math.round( months / 12 ) + ' year(s)';
};

Comment.prototype._addQuery = function( comment, status, assignee, notify, user ) {
    var that = this;
    var error;
    var modelDataStr;
    var q = {
        type: 'comment',
        id: ( ++this.ordinal ).toString(),
        date_time: this._getFormattedCurrentDatetimeStr(),
        comment: comment,
        status: status,
        assigned_to: assignee,
        notify: notify
    };

    if ( user ) {
        q.user = user;
    }

    this.notes.queries.unshift( q );

    // strip logs from model
    modelDataStr = JSON.stringify( {
        queries: that.notes.queries
    } );

    // update XML Model
    $( this.element ).val( modelDataStr ).trigger( 'change' );
    error = this._commentHasError();
    that._setCommentButtonState( that.element.value, error, status );
};

Comment.prototype._addAudit = function( comment, assignee, notify ) {
    this.notes.logs.unshift( {
        type: 'audit',
        date_time: this._getFormattedCurrentDatetimeStr(),
        comment: comment,
        assigned_to: assignee,
        notify: notify
    } );
};

Comment.prototype._addReason = function( reason ) {
    var modelDataStr;
    var that = this;
    var q;

    if ( !reason ) {
        return;
    }

    q = {
        type: 'reason',
        id: ( ++this.ordinal ).toString(),
        date_time: this._getFormattedCurrentDatetimeStr(),
        comment: reason
    };

    this.notes.queries.unshift( q );

    // strip logs from model
    modelDataStr = JSON.stringify( {
        queries: that.notes.queries
    } );

    // update XML Model
    $( this.element ).val( modelDataStr ).trigger( 'change' );
};

Comment.prototype._getCurrentStatus = function( notes ) {
    var status = '';

    notes.queries.concat( notes.logs ).some( function( item ) {
        if ( item.status ) {
            status = item.status;
            return true;
        }
        return false;
    } );
    return status;
};

Comment.prototype._getFormattedCurrentDatetimeStr = function() {
    var now = new Date();
    var offset = {};

    offset.minstotal = now.getTimezoneOffset();
    offset.direction = ( offset.minstotal < 0 ) ? '+' : '-';
    offset.hrspart = pad2( Math.abs( Math.floor( offset.minstotal / 60 ) ) );
    offset.minspart = pad2( Math.abs( Math.floor( offset.minstotal % 60 ) ) );

    return new Date( now.getTime() - ( offset.minstotal * 60 * 1000 ) ).toISOString()
        .replace( 'T', ' ' )
        .replace( 'Z', ' ' + offset.direction + offset.hrspart + ':' + offset.minspart );
};

Comment.prototype._getIsoDatetimeStr = function( dateTimeStr ) {
    var parts;
    if ( typeof dateTimeStr === 'string' ) {
        parts = dateTimeStr.split( ' ' );
        return parts[ 0 ] + 'T' + parts[ 1 ] + parts[ 2 ];
    }
    return dateTimeStr;
};

Comment.prototype._renderHistory = function() {
    var that = this;
    var emptyText = t( 'widget.dn.emptyHistoryText' ) || 'No History';
    var historyText = t( 'widget.dn.historyText' ) || 'History';
    var user = '<span class="icon fa-user"> </span>';
    var clock = '<span class="icon fa-clock-o"> </span>';

    var over3 = this.notes.queries.concat( this.notes.logs ).length - 3;
    var $more = over3 > 0 ? $( '<tr><td colspan="4"><span class="over">+' + over3 + '</span>' +
        '<button class="btn-icon-only btn-more-history"><i class="icon"> </i></button></td></tr>' ) : $();
    var $colGroup = this.notes.queries.concat( this.notes.logs ).length > 0 ? $( '<colgroup><col style="width: 31px;"><col style="width: auto;"></colgroup>' ) : $();
    this.$history.find( 'table' ).empty()
        .append( $colGroup )
        .append( '<thead><tr><th colspan="2" scope="col"><strong>' + historyText +
            '</strong></th><th scope="col">' + user + '</th><th scope="col">' + clock + '</th></tr></thead>' )
        .append( '<tbody>' +
            ( this.notes.queries.concat( this.notes.logs ).sort( this._datetimeDesc.bind( this ) ).map( function( item ) {
                    return that._getRows( item );
                } )
                .join( '' ) || '<tr><td colspan="2">' + emptyText + '</td><td></td><td></td></tr>' ) +
            '</tbody>'
        )
        .find( 'tbody' )
        .append( $more );

    this.$history
        .on( 'click', 'tbody td', function() {
            $( this ).toggleClass( 'wrapping', this.scrollWidth > this.clientWidth );
        } )
        .on( 'mouseenter', 'tbody td', function() {
            $( this ).toggleClass( 'overflowing', this.scrollWidth > this.clientWidth );
        } );

    $more.find( '.btn-more-history' ).on( 'click', function() {
        that.$history.toggleClass( 'closed' );
        return false;
    } );
};

Comment.prototype._getRows = function( item, options ) {
    var types = {
        comment: '<span class="icon tooltip fa-comment-o" data-title="Query/Comment"> </span>',
        audit: '<span class="icon tooltip fa-edit" data-title="Audit Event"> </span>',
        reason: '<span class="icon tooltip icon-delta" data-title="Reason for Change"> </span>'
    };
    if ( typeof item.user === 'undefined' ) {
        item.user = currentUser;
    }
    if ( typeof options !== 'object' ) {
        options = {};
    }
    var msg = item.comment || item.message;
    var rdDatetime = this._getReadableDateTime( item.date_time );
    var time = ( options.timestamp === 'datetime' ) ? rdDatetime : this._getParsedElapsedTime( item.date_time );

    var fullName = this._parseFullName( item.user ) || t( 'widget.dn.me' );

    return '<tr><td>' + ( types[ item.type ] || '' ) + '</td><td>' + msg + '</td><td>' +
        '<span class="username tooltip" data-title="' + fullName + ' (' + item.user + ')">' + fullName + '</span></td>' +
        '<td class="datetime tooltip" data-title="' + rdDatetime + '">' + time + '</td></tr>';
};

Comment.prototype._parseFullName = function( user ) {
    var fullName;

    if ( !user ) {
        return '';
    }

    users.some( function( u ) {
        if ( u.userName === user ) {
            fullName = u.firstName + ' ' + u.lastName;
            return true;
        }
    } );

    // use unchanged user as fallback if no match is found
    return fullName || user;
};

// Amend DN question to optimize for printing. Does not have to be undone, as it is not 
// use during regular data entry.
Comment.prototype._printify = function() {
    var labelText;
    var that = this;

    if ( this.$linkedQuestion.is( '.or-appearance-analog-scale' ) ) {
        var $clone = this.$linkedQuestion.find( '.question-label.widget.active' ).clone();
        $clone.find( 'ul, br' ).remove();
        labelText = $clone.text();
    } else {
        labelText = this.$linkedQuestion.find( '.question-label.active' ).text();
    }

    this.$commentQuestion
        .addClass( 'printified' )
        .append( '<table class="temp-print">' +
            this.notes.queries.concat( this.notes.logs ).sort( this._datetimeDesc.bind( this ) ).map( function( item ) {
                return that._getRows( item, { timestamp: 'datetime' } );
            } ).join( '' ) +
            '</table>'
        );

    var $existingLabel = this.$commentQuestion.find( '.question-label.active' );

    $existingLabel.attr( 'data-original', $existingLabel.text() );
    $existingLabel.text( 'History for - ' + labelText );
};

Comment.prototype._deprintify = function() {
    this.$commentQuestion
        .removeClass( 'printified' )
        .find( 'table.temp-print' ).remove();

    var $existingLabel = this.$commentQuestion.find( '.question-label.active' );
    $existingLabel.text( $existingLabel.attr( 'data-original' ) );

};

module.exports = Comment;
