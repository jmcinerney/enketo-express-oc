'use strict';

var $ = require( 'jquery' );
var t = require( './translator' ).t;

module.exports = {
    get $section() {
        this._$section = this._$section || $( '<section class="reason-for-change"><header class="reason-for-change__header"><h5>' +
            t( 'fieldsubmission.reason.heading' ) + '</h5><div class="question reason-for-change__header__apply-to-all">' +
            '<input class="ignore" type="text" name="common-rfc" placeholder="' + t( 'fieldsubmission.reason.placeholder1' ) + '"/>' +
            '<div class="option-wrapper"><label class=""><input class="ignore" type="checkbox" name="apply-to-all"/>' +
            '<span lang="" class="option-label active">' + t( 'fieldsubmission.reason.applytoall' ) + '</span></label></div></div>' +
            '</header></section>' ).insertBefore( '.form-footer' );
        return this._$section;
    },
    get questionMsg() {
        this._questionMsg = this._questionMsg || '<span class="oc-reason-msg active">' + t( 'fieldsubmission.reason.questionmsg' ) + '</span>';
        return this._questionMsg;
    },
    fields: [],
    numbers: [],
    addField: function( question ) {
        var $field;
        var $repeatNumber;
        var repeatNumber;
        var index;

        if ( this.fields.length === 0 ) {
            this.setApplyToAllHandler();
        }
        if ( this.fields.indexOf( question ) === -1 ) {
            // No need to worry about nested repeats as OC doesn't use them.
            $repeatNumber = $( question ).closest( '.or-repeat' ).find( '.repeat-number' );
            if ( $repeatNumber.length ) {
                repeatNumber = $repeatNumber.text() || 1;
                index = this.numbers.indexOf( $repeatNumber[ 0 ] );
                if ( index === -1 ) {
                    index = this.numbers.length;
                    this.numbers[ index ] = $repeatNumber[ 0 ];
                }
            }
            $field = $( '<div class="reason-for-change__item">' +
                '<span class="reason-for-change__item__label">' +
                $( question ).find( '.question-label.active' ).text() + '</span>' +
                ( repeatNumber ? '<span class="reason-for-change__item__repeat-number" data-index="' + index + '">(' + repeatNumber + ')</span>' : '' ) +
                '<input class="ignore" type="text" placeholder="' + t( 'fieldsubmission.reason.placeholder2' ) + '"/></div>' );
            this.fields.push( question );
            $( question ).append( this.questionMsg );
            return $field.appendTo( this.$section );
        }
        return $();
    },
    removeField: function( question ) {
        var index = this.fields.indexOf( question );
        if ( index !== -1 ) {
            this.fields.splice( index, 1 );
            // is this robust?
            this.$section.find( '.reason-for-change__item' ).eq( index ).remove();
        }
    },
    clearAll: function() {
        this.$section.find( '.reason-for-change__item' ).remove();
        this.$section.find( 'input[name="apply-to-all"]' ).prop( 'checked', false );
        this.$section.find( 'input[name="common-rfc"]' ).val( '' );
        this.fields = [];
    },
    getInvalidFields: function() {
        this.validate();
        return this.$section.find( '.reason-for-change__item.invalid input' );
    },
    setInvalid: function( inputEl ) {
        this.changeFieldStatus( inputEl, 'invalid' );
    },
    setSubmitted: function( inputEl ) {
        this.changeFieldStatus( inputEl, 'added' );
        inputEl.dataset.previousValue = inputEl.value;
    },
    setEdited: function( inputEl ) {
        // only set edited status if the field has been submitted previously
        if ( this.hasSubmitted( inputEl ) ) {
            if ( inputEl.value === inputEl.dataset.previousValue ) {
                // remove statuses to go back to 'added' status only
                this.changeFieldStatus( inputEl, 'added' );
            } else {
                this.changeFieldStatus( inputEl, 'edited' );
            }
        }
    },
    setNumber: function( el, number ) {
        el.textContent = '(' + number + ')';
    },
    getIndex: function( inputEl ) {
        return this.$section.find( '.reason-for-change__item' ).index( $( inputEl ).closest( '.reason-for-change__item' ) );
    },
    hasSubmitted: function( inputEl ) {
        return inputEl.parentNode.classList.contains( 'added' );
    },
    changeFieldStatus: function( inputEl, status ) {
        // we never remove the "added" class
        inputEl.parentNode.classList.remove( 'edited', 'invalid' );
        if ( status ) {
            inputEl.parentNode.classList.add( status );
        }
        this.updateQuestionMessage( inputEl, status );
    },
    updateQuestionMessage: function( inputEl, status ) {
        var question = this.fields[ this.getIndex( inputEl ) ];
        var existingMsg = question.querySelector( '.oc-reason-msg' );
        if ( status === 'edited' || status === 'added' ) {
            if ( existingMsg ) {
                existingMsg.remove();
            }
        } else if ( !existingMsg ) {
            $( question ).append( this.questionMsg );
        }
    },
    updateNumbering: function() {
        var that = this;
        // removing repeats has a delay
        setTimeout( function() {
            that.$section.find( '.reason-for-change__item__repeat-number' ).each( function() {
                that.setNumber( this, that.numbers[ this.dataset.index ].textContent );
            } );
        }, 800 );
    },
    validate: function() {
        var that = this;
        var valid = true;

        this.$section.find( '.reason-for-change__item:not(.added) input' ).each( function() {
            that.setInvalid( this );
            valid = false;
        } );

        return valid;
    },
    getFirstInvalidField: function() {
        return this.$section[ 0 ].querySelector( '.invalid input' );
    },
    setValue: function( el, newVal ) {
        if ( el.value.trim() !== newVal.trim() ) {
            $( el ).val( newVal ).trigger( 'change' );
        }
    },
    applyToAll: function() {
        var that = this;
        var $checkbox = this.$section.find( 'input[name="apply-to-all"]' );
        var $input = this.$section.find( 'input[name="common-rfc"]' );
        if ( $checkbox.is( ':checked' ) ) {
            that.$section.find( '.reason-for-change__item input[type="text"]' ).each( function() {
                that.setValue( this, $input.val() );
            } );
        }
    },
    setApplyToAllHandler: function() {
        this.$section.find( '.reason-for-change__header' )
            .on( 'change', this.applyToAll.bind( this ) );
    }
};
