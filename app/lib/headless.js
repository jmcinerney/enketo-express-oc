const config = require( '../models/config-model' ).server;
const timeout = config.headless.timeout;
const puppeteer = require( 'puppeteer' );

let crash = false; // Math.round( Math.random() * 10 ) % 2;

/*class Chrome {
    constructor() {
        this.createBrowser();
    }
    async createBrowser() {
        console.log( 'Launching browser', this instanceof Chrome );
        this.browser = await puppeteer.launch( { headless: true, devtools: false } );
        this.browser.on( 'disconnected', this.createBrowser.bind( this ) );
        console.log( 'Browser launched' );
    }
}*/

// Launch one browser (on each thread) and let it re-launch itself when it crashes.
//const chrome = new Chrome();

async function run( url ) {

    if ( !url ) {
        throw new Error( 'No url provided' );
    }
    console.log( 'crashing planned?', crash );
    //const browser = await chrome.browser;
    const browser = await puppeteer.launch( { headless: true, devtools: false } );
    const page = await browser.newPage();
    let fieldsubmissions;

    if ( crash ) {
        setTimeout( function() {
            console.log( 'simulating browser crash' );
            crash = false;
            browser.close();
        }, 0.5 * timeout );
    }

    try {
        page.on( 'pageerror', e => {
            // I have not been able to actually reach this code.
            e.status = 400;
            throw e;
        } );
        page.on( 'requestfailed', e => {
            // I have not been able to actually reach this code.
            e.status = 400;
            throw e;
        } );

        await page.goto( url ).catch( e => {
            // I have not been able to actually reach this code.
            e.status = 400;
            throw e;
        } );
        //await page.evaluate( () => { throw new Error( 'js throw some error' ); } );
        const element = await page.waitForSelector( '#headless-result', { timeout } ).catch( e => {
            // I have not been able to actually reach this code.
            e.status = /timeout/i.test( e.message ) ? 408 : 400;
            throw e;
        } );
        const errorEl = await element.$( '#error' );
        // LoadErrors caught by Enketo
        if ( errorEl ) {
            const msg = await errorEl.getProperty( 'textContent' );
            const error = new Error( await msg.jsonValue() );
            error.status = 400;
            throw error;
        }
        const fsEl = await element.$( '#fieldsubmissions' );
        if ( fsEl ) {
            const fs = await fsEl.getProperty( 'textContent' );
            fieldsubmissions = Number( await fs.jsonValue() );
        }
    } catch ( e ) {
        e.status = e.status || 400;
        await page.close();
        throw e;
    }
    console.log( 'closing page' );
    await page.close();
    await browser.close();

    return fieldsubmissions;
}

module.exports = { run };
