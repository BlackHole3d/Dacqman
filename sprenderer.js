// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.

//const SerialPort = require('serialport') // from 6.1.0 days
const { SerialPort } = require('serialport') // 10.x

// parser requires a newer serialport, like 7.x.x
// whereas we were using and specifying 6.1.0 initially
// as this built and installed ok with other dependencies, but does not yet
// include parsers
//const Delimiter = require('@serialport/parser-delimiter')

const createTable = require('data-table')
var port; // old / vcp app only
var dport  // the data port
var device //
var cport // control port

const Ftdi = require('ftdi-d2xx'); // require('ftdi'); for when was a 3rd party file locally modded

const FtdiWrapped = require('./ftdi-d2xx-wrap.js');



// For debugging
//var util = require('util');



const electron = require('electron');
const {ipcRenderer} = electron;

// TODO I don't think this is right
const { dialog } = require('electron').remote;

const fs = require('fs');

//const CaptureDataFileOutput = require('./capture-data.js');
const { CaptureDataFileOutput : CaptureDataFileOutput } = require('./capture-data.js');

const { UserInterface : YouFace } = require('./userInterface.js');


var buf = []; // new Uint8Array; //[];
var nsamp = 4096;
var filling = false;
var samples = 0;
var tstart = 0;
var tstop = 0;
var time;






async function vcpFind() {
  try {
    const ports = await SerialPort.list();
    console.log('ports', ports);

    if (ports.length === 0) {
      document.getElementById('vcp_error').textContent = 'No serial ports discovered';
      return;
    }

    document.getElementById('vcp_error').textContent = 'No VCP errors, so far.';

    var headers = Object.keys(ports[0]);
    headers.push('selectthisone');
    const table = createTable(headers);
    var tableHTML = '';

    table.on('data', (data) => (tableHTML += data));
    table.on('end', () => (document.getElementById('vcp_ports').innerHTML = tableHTML));

    ports.forEach(function (port) {
      var p = {};
      Object.keys(port).forEach(function eachKey(key) {
        p[key] = port[key];
      });
      p.selectthisone =
        "<button id=\"b1\" name=\"" + port['comName'] + "\" onclick=\"serialSelect(this)\">selectme</button>";
      table.write(p);
    });

    table.end();
  } catch (err) {
    document.getElementById('vcp_error').textContent = err.message;
  }
}





// List devices via D2XX FTDI (node ftdi)
async function ftdiFind() { // node ftdi old local file was not async
  const devices = await Ftdi.getDeviceInfoList(); // new ftdi-d2xx
  //Ftdi.find( function(err, devices) { // old
    console.log(devices.length + " FTDI (D2XX) Devices Found.");
    // if (err) { // from old
    //   document.getElementById('ftdi_error').textContent = err.message
    //   //return
    // } else {
    //   document.getElementById('ftdi_error').textContent = 'No FTDI errors, so far.'
    // }
    if (devices.length === 0) {
      document.getElementById('ftdi_error').innerText = 'No FTDI ports (via non-VCP) found.'
    }

    var headers;
    if ( devices.length > 0 ) {
      //var fd = new Ftdi.FtdiDevice(devices[0]); // old
      console.log(devices);
      var fd = devices[0];
      //headers = Object.keys(fd.deviceSettings); // old
      headers = Object.keys(fd);
    } else {
      // old node-ftdi below - but doesn't work for ftdi-d2xx(-wrap)
      //headers = Object.keys(new Ftdi.FtdiDevice({ locationId: 0, serialNumber: 0}).deviceSettings);
      // currently no work around built for the Ftdi ftdi-d2xx solution yet
      headers = Object.keys(FtdiWrapped.FtdiDeviceWrapped.FTDI_DeviceInfoBlank());
    }
    headers.push("UseForData");
    headers.push("UseForControl");
    table = createTable(headers);
    tableHTML = ''
    table.on('data', data => tableHTML += data)
    table.on('end', () => {
      document.getElementById('ftdi_ports').innerHTML = tableHTML;
      // in Win 10 VM 2012 MBP FTDI load/find takes 15 seconds so we add this here to fire at end - 
      // likely a better concept anyway - TODO needs use case testing though across platforms
      // hook here too - TODO figure out with the ready() mainWindow.js timeout function as well
      // TODO could be to put 2x item checklist that when complete fires serialCheckbox - 
      // so like when both tables of devices are complete
      serialCheckbox();
    });

    // Now see if we can set some defaults
    // If two consecutive FTDI devices have serialNumber the same, except first is A and 2nd is B in last digit
    // and vendor and product ID are the same - then A is Data and B is control
    // If we see this once, then stop.
    // If there is a 2nd occurence, leave it to the user to correct this, in the event
    // there are two similar devices connected to the PC
    // TODO we are assuming sort order gives ports as A then B
    // To sort on Keys, see:
    // https://stackoverflow.com/questions/16648076/sort-array-on-key-value
    var i;
    devices.forEach( function(d) {
      d["UseForDataChecked"] = '';
      d["UseForControlChecked"] = '';
    });

    // setTimeout with an implied time of zero puts his on the queue such that the innerHTML from the 
    // create table code above completes prior to executing this function - a function that uses that 
    // html table to determine whats up
    //setTimeout(guessAndSetHardwareIdentity);

    // TODO Win 10 VM on Mac 10.15.7 this takes like 15 seconds to complete
    // need to test obviously on other platforms and native
    // nonetheless update button showing that the findFtdi is in progress!

    // Try to auto check the checkboxes for data / control if applicable 
    for ( i = 0; i < devices.length; i++) {
      if ( i + 1 >= devices.length ) {
        break;
      }
      var d1 = devices[i];
      var d2 = devices[i+1];
      var sn1 = d1["serial_number"]; // old: serialNumber; ftdi-d2xx => serial_number
      var sn2 = d2["serial_number"];
      console.log("FTDI sn1: " + sn1);
      console.log("FTDI sn2: " + sn2);
      // old: vendorId productId
      // ftdi-d2xx: usb_vid, usb_pid
      // below: now with ftdi-d2xx 1.1.2 and serialport 10.5.0
      // there is no longer any serial number at all in either FTDI or VCP tables
      // but the description ends with A / B
      if ( sn1.length === 0 && sn2.length === 0 ) {
        sn1 = d1["description"];
        sn2 = d2["description"];
        console.log(`serial_number fields were blanks so using descriptions ${sn1} ${sn2}. /
          Maybe this is non-EEPROM FTDI based USB 485 device.`);
      }
      if ( d1["usb_vid"] === d2["usb_vid"] && d1["usb_pid"] === d2["usb_pid"] ) { // old: vendorId productId
        console.log("Same device vendorId (usb_vid) and productId (usb_pid)");
        if ( sn1.substr(0, sn1.length - 2) === sn2.substr(0, sn2.length - 2) ) {
          console.log("Same device serial number base");
          if ( sn1.substr(sn1.length - 1, 1) === 'A' && sn2.substr(sn2.length - 1, 1) === 'B' ) {
            console.log("Devices have correct A/B sequence for suffixes");
            // DOM isn't ready yet if we place after table generation
            // and then use ID selectors in jquery - there are ways around this
            // for now, this if faster in dev
            devices[i].UseForDataChecked = "checked";
            devices[i+1].UseForControlChecked = "checked";
          }
          // On Win 10 VM via Mac 10.15.7 using FTDI USB-COM485 Plus2 the enum goes B then A
          if ( sn1.substr(sn1.length - 1, 1) === 'B' && sn2.substr(sn2.length - 1, 1) === 'A' ) {
            console.log("Devices have a B/A sequence for suffixes...assuming this is reverse order");
            devices[i+1].UseForDataChecked = "checked";
            devices[i].UseForControlChecked = "checked";
          }
        }
      }
    }


    devices.forEach ( function(d) {
      //var fd = new Ftdi.FtdiDevice(d); // old
      //console.log(fd.deviceSettings.description); // old
      console.log(d.description); // ftdi-d2xx

      //console.log(JSON.stringify(fd));

      /*if ( (headers.length - 2) < Object.keys(fd.deviceSettings).length ) {
        console.log("re set headers for ftdi table")
        headers = Object.keys(fd.deviceSettings);
        headers.push("UseForData");
        headers.push("UseForControl");
        table = createTable(headers);
        tableHTML = ''
        table.on('data', data => tableHTML += data)
        table.on('end', () => document.getElementById('ftdi_ports').innerHTML = tableHTML)
      }*/

      var p = {}
      // old
      // Object.keys(fd.deviceSettings).forEach(function eachKey(key) {
      //   p[key] = (fd.deviceSettings[key]).toString();
      // })
      Object.keys(d).forEach(function eachKey(key) {
        p[key] = (d[key]).toString();
      })

      //p.UseForData = `<button id="${p["locationId"]}" tag="${p["serialNumber"]}" name="${p["description"]}" onclick="serialSelect(this)">Data</button>`;
      // Per materializecss docs:
      // Match the label for attribute to the input's id value to get the toggling effect
      console.log(d["UseForDataChecked"]);
      // Update: On Win 10 so far, just creating an id using UseForData+locationId means that for the dual port device like the 
      // RS104 hardware, using a network USB bridge (connect local USB device to PC running DacqMan over the LAN) 
      // both parts of the serial device will have the same location ID which makes the materializecss checkbox 
      // functionality break (because two checkboxes have the same ID)
      // So, we add also the index
      // HOWEVER this breaks the functionality for the RS8 (0108) because that added index 
      // creates a location ID that doesn't work in trying to open the FTDI device instance 
      // at least on Mac OS so far 
      // For example: old code: locationId: 82017 (excluding the index) works to open data port FTDI (D2xx)
      //              newer code: locationId+index: 820170 (appended index) breaks RS8 for FTDI/D2xx
      // So we need to extract the locationId somehow correctly or store it
      // Let's use HTML data- attribute
      // like data-locationId is just the locationId 
      // Then to grab this we need to update code in like: checkboxToPortHash to not grab from 
      // id and extract - but rather to use the data-locationId and hopefully not break anything?
      //p.UseForData = `<p><label for="UseForData${p["locationId"]}${p["index"]}"><input type="checkbox" id="UseForData${p["locationId"]}${p["index"]}" tag="${p["serialNumber"]}" name="${p["description"]}" ${d["UseForDataChecked"] === "" ? "" : "checked=\"checked\""} onclick="serialCheckbox(this)" /><span>Data</span></label></p>`;
      //p.UseForControl = `<p><label for="UseForControl${p["locationId"]}${p["index"]}"><input type="checkbox" id="UseForControl${p["locationId"]}${p["index"]}" tag="${p["serialNumber"]}" name="${p["description"]}" ${d["UseForControlChecked"] === "" ? "" : "checked=\"checked\""} onclick="serialCheckbox(this)" /><span>Control</span></label></p>`;
      // Note that data-attributes get lower-cased
      // old ftdi driver local file rebuild adapted:
      //p.UseForData = `<p><label for="UseForData${p["locationId"]}${p["index"]}" data-locationid="${p["locationId"]}"><input type="checkbox" id="UseForData${p["locationId"]}${p["index"]}" tag="${p["serialNumber"]}" name="${p["description"]}" ${d["UseForDataChecked"] === "" ? "" : "checked=\"checked\""} onclick="serialCheckbox(this)" /><span>Data</span></label></p>`;
      //p.UseForControl = `<p><label for="UseForControl${p["locationId"]}${p["index"]}" data-locationid="${p["locationId"]}"><input type="checkbox" id="UseForControl${p["locationId"]}${p["index"]}" tag="${p["serialNumber"]}" name="${p["description"]}" ${d["UseForControlChecked"] === "" ? "" : "checked=\"checked\""} onclick="serialCheckbox(this)" /><span>Control</span></label></p>`;

      // new ftdi-d2xx usage
      p.UseForData = `<p><label for="UseForData${p["usb_loc_id"]}${p["index"]}" data-locationid="${p["usb_loc_id"]}"><input type="checkbox" id="UseForData${p["usb_loc_id"]}${p["index"]}" tag="${p["serial_number"]}" name="${p["description"]}" ${d["UseForDataChecked"] === "" ? "" : "checked=\"checked\""} onclick="serialCheckbox(this)" /><span>Data</span></label></p>`;
      p.UseForControl = `<p><label for="UseForControl${p["usb_loc_id"]}${p["index"]}" data-locationid="${p["usb_loc_id"]}"><input type="checkbox" id="UseForControl${p["usb_loc_id"]}${p["index"]}" tag="${p["serial_number"]}" name="${p["description"]}" ${d["UseForControlChecked"] === "" ? "" : "checked=\"checked\""} onclick="serialCheckbox(this)" /><span>Control</span></label></p>`;



      table.write(p)
    });
    table.end();

    
  //}); // end of Ftdi.find // old



} // function ftdiFind







// TODO 11/27/19
// - complete wiring up the open/close/testwrite buttons and diable/enable
//   functionality for the control port
// - after data port finishes it's startup speed test for now, and for any disabled-ness
//   wire up that a click sees if it can re-open that port, and then green and then
//   if click, then show the data port interaction pane, including 3 button basics
//   eg open, close, and maybe like measure incoming data sample rate
//


// https://serialport.io/docs/en/api-stream
// For driver management on  Mac OS X, see Readme
// Tested with 115200
// After plist update to the right FT2232H_A (?) device ID in the Plist.info
// for the FTDI driver and kextunload and kextreload mapping 300 to 12000000...
// Aliasing seems to be not working
// Direct use of 3,000,000 looks ok - directly as a call
// But can't call with a higher value, and aliasing seems to do nothing

// BELOW: For VCP including AppleUSBFTDI
// First testing version of function, for traditional VCP style only
var serialOpenByName = function (name) {

  //port = new SerialPort(name, { autoOpen: false, baudRate: 3000000 }, function (err) {
  var settings = {
    autoOpen: false,
    baudRate: 57600, //9600, //57600, //921600, //57600, F
    databits: 8,
    stopbits: 1,
    parity  : 'none',
  };
  port = new SerialPort(name, settings, function (err) {
    if ( err ) {
      return console.log('sprenderer: error on create new: ', err.message)
    }
  });
  port.on('open', function() {
    console.log('port.on open');
  });
  //port.on('data', function (data) {
  //  console.log('Data: ', data);
  //});
  port.on('data', function (data) {
    console.log ("port.on data");
    //if ( data.length > 3000 ) {  // just testing - so would like to see a large sample
    if ( !filling ) {
      setTimeout(function() {
        mainWindowUpdateChartData(buf);
        buf = [];
        filling = false;
      }, 3000);
      filling = true;
    }
    if ( filling ) {
      data.forEach(function(d) {
        buf.push(d);
      });
    }

    //ipcRenderer.send('port:ondata', data);
    //console.log('Data: (length): ', data.length);
    console.log(data);
    console.log("Same data parsed as ASCII chars: ");
    console.log(hexBufToAscii(data));
    //}
  });
  port.open()
}
/* ABOVE: Standard VCP Serial port, works with AppleUSBFTDI too */








// BELOW: For D2XX FTDI -
// first dev testing function - retained for reference and testing for now
var devSerialOpenByName = function (name) {

  port = new Ftdi.FtdiDevice(0); // for d2xx only

  port.on('error', function(err) {
    console.log('port.on error: ', err);
  });
  port.on('close', function(err) {
    console.log('close event subscription ');
    console.timeEnd("timeOpen");
    console.log("samples collected: " + samples);
    const difftime = process.hrtime(time);
    // difftime contains [seconds, nanoseconds] difference from start time
    const nsps = 1e9; // nano sec per sec
    var dt_sec = difftime[0] + difftime[1]/nsps;
    var sps = samples / dt_sec;
    console.log(`Delta time by hrtime: ${dt_sec} seconds giving ${sps} samples per second for ${samples} samples.`);

    // 261120 samples in about 1 Second
    // 32347.4 samples per chan in that time
    // Target sample trig rate: 7.8125 ms (sweeping 8 chans)
    // 2500 samples / 7.8125ms => 320 samples/ms => 320000 samples / second
    // We are close - the 261120 is repeatable
    // However, FPGA set up for 4096 samples per buffer or snapshot
    // so at 4096 samples / 7.8125 ms => 524288 samples per second
    // so, 261,120 is about half that, half that would be 262,144 (the difference is just 1024)
    // so perhaps the toggling of the pin on the MCU is just half the sample trigger rate,
    // howeve also, it seems that generally data rate may be good
    // yes, we are just toggling, so need to double this ...
    //
    // Now with 7.8125 ms clock timing and ISR running high/low getting
    // 526320 samples per approx second
    // Expectation would be:
    // 4096 samples / 7.8125 ms X 1000 ms / s => 524,288 samples/second
    // This is 4 x 2 x 2 for 1/2 inch transducers, 1/2 overlap, 4 in/sec travel speed
    // => 128 WFs/sec, assuming equally spaced in time gives 7.8125ms capture
    // and transmit the waveform of 4096 (was 2500) samples or whatever length + headers

    console.log(`For 4096 of 8-bit data or samples each for 128 WF/sec is 4096x128 = 524,288 bytes/sec`);
    var dsps = sps - (4096 * 128);
    console.log(`Actual samples per second (sps) - theoretical sps: ${dsps} sps => ${dsps/(4096*128)*100}%`);
    console.log(`Delta samples in the 1 second sample period, excluding port overhead, actual samples - theoretical: ${samples - 4096*128}`);


  });
  port.on('open', function(err) {
    console.log('port.on open');
    console.time("timeOpen");
    //time = process.hrtime();  // restart the timer, storing in "time"
    setTimeout( function() {
      port.close();
    }, 1000);
  });
  port.on('data', function (data) {
    console.log ("port.on data");

    if ( !time ) {
      time = process.hrtime();  // restart the timer, storing in "time"
    }

    // data is a NodeJS Buffer object
    console.log("buf.length (pre-append): " + buf.length);
    buf.push(...data);
    //console.log(JSON.stringify(buf));
    console.log("buf.length: " + buf.length);
    /*if ( buf.length >= 2500 ) {
      console.log("buf.length: " + buf.length);
      mainWindowUpdateChartData(buf.slice(0,2499));
      buf = [];
    }*/
    samples += data.length;

    //if ( !filling ) {
      /*setTimeout(function() {
        mainWindowUpdateChartData(buf);
        buf = [];
        filling = false;
      }, 2000);
      filling = true;
      */
      //mainWindowUpdateChartData(buf);
      //buf = [];
    //}

    /*if ( filling ) {
      data.forEach(function(d) {
        buf.push(d);
      });
    }*/

    //ipcRenderer.send('port:ondata', data);
    //console.log('Data: (length): ', data.length);
    //console.log(data);
    //}
  });

  // Really for this to work, you need to:
  // Install the D2XX driver package
  // Install the D2XX helper package (if applicable)
  // kextunload the vcp driver (on Mac OS X anyway)
  // And then in the serial port list, your FTDI driver won't show (!)
  // But if you only have one FTDI device connected,
  // the stuff below works
  // And testing with OScope - yes, single bit is 12MHz time long
  // Or 6MHz clock cycle or so -- so we're in the right ballpark
  // We've updated the node-ftdi wrapper such that opening without a baudrate
  // and data format may give errors (as expected) to the console, but now
  // can return without error such that program execution continues -
  // because using this with eg async 245 fifo mode doesn't require that information
  // and futher that information has no meaning - so we only need the open call
  //
  // Thus even if using D2XX correctly, you will see output like:
  // Can't setBaudRate: FT_IO_ERROR
  // Can't Set DeviceSettings: FT_IO_ERROR
  //
  // This will be for any baud rate, and so far it is believed this is because
  // simply in a/sync 245 FIFO mode, these settings have no meaning
  // Rather data is just returned as clocked.
  // TODO Vfy clocking rate now with in-circuit usingHDL-0108-RSCPT Actual
  //
  // Again: settings now shown for concept, but regardless, opening with
  // any baud rate, even standard, will throw errors shown above just due to
  // irrelevance, it is thought ...
  var settings = {
    baudrate: 12000000, //57600, // either way, error(s) will be thrown at app log output (command line)
    databits: 8,
    stopbits: 1,
    parity  : 'none',
  };
  port.open({ //{
    //baudrate: 12000000,
    //databits: 8,
    //stopbits: 1,
    //parity: 'none',
    //// bitmode: 'cbus', // for bit bang
    //// bitmask: 0xff    // for bit bang
    settings
  });


  //});
}
/* */ /* ABOVE: For D2XX */









var btnDataPortClick = function(button) {
  if ( $(button).hasClass("green") === false ) {
    //console.log("data port button clicked: but button is not green = active port - so, returning");
    openDataPortThatIsChecked();
  } else {
    if ( dport ) {
      dport.close();
    } else {
      console.log("data port button clicked: button is not green = active port but dport is not anything, so can't do anything to close it - so, returning");
    }
  }
}








var btnControlPortClick = function(button) {

  // For control port button, instead we just use color as an indicator
  // and the click only for expansion/hide section
  // This demo's standard control buttons within the section

  //if ( $(button).hasClass("green") === false ) {
    //console.log("control port button clicked: but not active - returning");
    ////return;
    //openControlPortThatIsChecked();
  //} else {
    if ( $('#activeControlPort').is(":visible") ) {
      $('#activeControlPort').hide("slow");
      $(button).removeClass("expanded");
      return;
    }
    $('#activeControlPort').show("slow");
    $(button).addClass("expanded");
  //}


}







//var datBuf = Buffer.alloc(4096, 63); // allocate 4096 byte buffer, fill with 0x00
// Below for FTDI D2XX - for the data port (async fifo styling of streaming data)
var sofFound = false;
var srcIndexStart = 0;
var openDataPort = function(portHash) {

  if ( hw ) {

    if (hw.dataPortType.toUpperCase().includes("VCP")) {
      openDataPortVcp(portHash);
    } 
    else
    if (hw.dataPortType.toUpperCase().includes("FTDI")) {
      openDataPortFtdi(portHash);
    }
    else 
    if (hw.dataPortType.includes("SameAsControl")) {
      // We use only the control port
      console.log("openDataPort: Skipping opening the data port, as it is the SameAsControl in hardwares.json and by selection");
    }
    else 
    {
      console.error("openDataPort: hw.dataPortType did not include any handled case! You will probably not see any data coming in to the graphs.  This could be sad.  This is probably a software issue. Please contact emergency dev team POC to fix.");
    }

  } else {

    console.warn("hw variable identifying the hardware characteristics is not defined; using Vcp vs Ftdi port driver based on assumption of hardware-id text containing RS104 or not.");
    
    if ( $("#hardware-id").text().includes("RS104") ) {
      openDataPortVcp(portHash);
    } else {
      openDataPortFtdi(portHash);
    }

  }

} // end of: openDataPort(portHash)








var openDataPortFtdi = function(portHash) {
  console.log("openDataPortFtdi: " + JSON.stringify(portHash));

  // old 
  // dport = new Ftdi.FtdiDevice({
  //   locationId: portHash.locationId,
  //   serialNumber: portHash.serialNumber }); // for d2xx only

  // new ftdi-d2xx - TODO PERHAPS CAN IMPROVE? DEVICE LIST?
  //dport = new Ftdi.openDevice(portHash.serialNumber); // old in transition to ftdi-d2xx
  // dport = Ftdi.openDevice(portHash.serialNumber)
  //   .then( (fd) => { // Promise returned is FTDI_Device from ftdi-d2xx
  //     console.log(fd);
  //   });

  dport = new FtdiWrapped.FtdiDeviceWrapped(portHash.serialNumber);
  //dport.open(); // testing - real open happens after items are set up

  // in this ftdi-d2xx - now it is wrapped and this event is added
  dport.on('error', function(err) {
    console.error('dport.on error: ', JSON.stringify(err));
    if ( err.type && err.type === "BufferOverflow" ) {
      $('#btnBufferOverflowing').removeClass('disabled').addClass('orange pulse');
      $('#btnBufferOverflowing').attr("title", "DataPortFtdi BufferOverflow Detected. Click to Reset.");
      $('#btnBufferOverflowing').click( ()=> {
        $('#btnBufferOverflowing').removeClass('orange pulse').addClass('disabled');
        $('#btnBufferOverflowing').attr("title","");
      });
    }
  });

  dport.on('close', function(err) {
    console.log('dport.on close ie close event subscription ');
    console.timeEnd("timeOpen");
    console.log("samples collected: " + samples);
    const difftime = process.hrtime(time);
    // difftime contains [seconds, nanoseconds] difference from start time
    const nsps = 1e9; // nano sec per sec
    var dt_sec = difftime[0] + difftime[1]/nsps;
    var sps = samples / dt_sec;
    console.log(`Delta time by hrtime: ${dt_sec} seconds giving ${sps} samples per second for ${samples} samples.`);

    // 261120 samples in about 1 Second
    // 32347.4 samples per chan in that time
    // Target sample trig rate: 7.8125 ms (sweeping 8 chans)
    // 2500 samples / 7.8125ms => 320 samples/ms => 320000 samples / second
    // We are close - the 261120 is repeatable
    // However, FPGA set up for 4096 samples per buffer or snapshot
    // so at 4096 samples / 7.8125 ms => 524288 samples per second
    // so, 261,120 is about half that, half that would be 262,144 (the difference is just 1024)
    // so perhaps the toggling of the pin on the MCU is just half the sample trigger rate,
    // howeve also, it seems that generally data rate may be good
    // yes, we are just toggling, so need to double this ...
    //
    // Now with 7.8125 ms clock timing and ISR running high/low getting
    // 526320 samples per approx second
    // Expectation would be:
    // 4096 samples / 7.8125 ms X 1000 ms / s => 524,288 samples/second
    // This is 4 x 2 x 2 for 1/2 inch transducers, 1/2 overlap, 4 in/sec travel speed
    // => 128 WFs/sec, assuming equally spaced in time gives 7.8125ms capture
    // and transmit the waveform of 4096 (was 2500) samples or whatever length + headers

    /* Needs new implementation:
    console.log(`For 4096 of 8-bit data or samples each for 128 WF/sec is 4096x128 = 524,288 bytes/sec`);
    var dsps = sps - (4096 * 128);
    console.log(`Actual samples per second (sps) - theoretical sps: ${dsps} sps => ${dsps/(4096*128)*100}%`);
    console.log(`Delta samples in the 1 second sample period, excluding port overhead, actual samples - theoretical: ${samples - 4096*128}`);
    */

    $("#btnDataPortStatus").removeClass('green pulse').addClass('blue-grey');
    $("#btnListeningForData").removeClass('pulse').addClass('disabled');
    $("#btnSilenceIndicators").addClass('disabled');

    mainWindowUpdateChartData(null); // should call the cancel on the requestAnimationFrame

  });

  dport.on('open', function(err) {
    // TODO checkbox for run test on open
    //$("#serialPortGoButton").addClass("lighten-5");
    //$("#serialPortGoButton").removeClass("waves-light");
    // TODO we can now DRY below as it is now used twice - also in singular serial port open control
    $("#serialPortGoButton").addClass("red");
    $("#btnDataPortStatus").removeClass('hide blue-grey').addClass('green'); // TODO-TBD Used to have the pulse class set, removed for UI overlays TODO could make this conditional
    $("#btnListeningForData").removeClass('hide disabled').addClass('pulse');
    $("#active_ports_ui_status_indicators").removeClass('hide');
    $("#active_ports_ui_buttons").removeClass('hide');
    $("#btnSilenceIndicators").removeClass('disabled');
    console.log('dport.on open');
    console.time("timeOpen");
    //time = process.hrtime();  // restart the timer, storing in "time"

    sofFound = false;

    mainWindowUpdateChartData(null); // init the loop for requestAnimationFrame

    // Optionally stop the pulsing
    /*setTimeout( function() {
      $("#btnListeningForData").removeClass('pulse');
      $("#btnDataPortStatus").removeClass('pulse');
      // TODO check if any have pulse, and if not then disable btnSilenceIndicators
    }, 5000);
    */


    /*
    //For Freq measurement real world samples over time
    setTimeout( function() {
      dport.close();
    }, 1000);
    */

  });

  //var n = 0;
  //var sofFound = false;
  //var srcIndexStart = 0;
  const sof = [0xaa, 0x55, 0xaa, 0x55, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0xff, 0x00];
  const sofSkipMatchByte = [ 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0];
  dport.on('data', function (data) {
    //console.log ("dport.on data");
    //console.log(data);

    // Freq measuring stuff
    /*
    if ( !time ) {
      time = process.hrtime();  // restart the timer, storing in "time"
    }

    // data is a NodeJS Buffer object
    console.log("buf.length (pre-append): " + buf.length);
    buf.push(...data);
    //console.log(JSON.stringify(buf));
    console.log("buf.length: " + buf.length);
    */

    var pushStartIndex = 0;

    if ( !sofFound ) {

      // Wait for and start dumping data on SOF found
      // SOF goes:
      // initial begin
      // sof[0] <= 8'h aa;
      // sof[1] <= 8'h 55;
      // sof[2] <= 8'h aa;
      // sof[3] <= 8'h 55;
      //
      // sof[8] <= 8'h ff;
      // sof[9] <= 8'h 00;
      // sof[10] <= 8'h ff;
      // sof[11] <= 8'h 00;
      // end

      console.log("looking for SOF (sofFound === false)");

      buf.push(...data);
      console.log(buf);

      var sofSize = 12;
      var bufSize = 4095;
      const bufMult = 10;

      if ( buf.length > (sofSize -1) && buf.length < (bufSize * bufMult + 1 - sofSize) ) {

        var matchIndex = buf.indexOf(0xAA, srcIndexStart);
        console.log("matchIndex: " + matchIndex + " for srcIndexStart: " + srcIndexStart);

        if ( matchIndex > -1 ) {

          var stillGood = true;
          var i = 0;
          while ( stillGood  && ( i < sofSize ) ) {
            if ( !sofSkipMatchByte[i] ) {
              stillGood = buf[ matchIndex + i ] === sof[ i ];
            }
            i++;
          }

          console.log("stillGood: " + stillGood + " for i breaking out of while at: " + i);
          if ( stillGood ) {
            sofFound = true;
            pushStartIndex = matchIndex; // yes, we'll keep the SOF bytes in the graph output / buffer
            console.log("pushing starting from: " + pushStartIndex + " to stream buffer from source buffer of size: " + buf.length);
            var b = new Buffer.from(buf.slice(pushStartIndex));
            // Yes, we want to "put" a typeof Buffer here - otherwise weird behavior with current versions, perhaps all versions
            ourReadableStreamBuffer.put(b); //, buf.length));
            //console.log(buf.slice(pushStartIndex, buf.length));
            buf = [];
            srcIndexStart = 0; //??// already reset on each port open, so not needed?
          } else {
            srcIndexStart += i;
          }

        } else {  // match not found
          srcIndexStart += buf.length;
        }

      } else if ( buf.length > (bufSize * bufMult - sofSize) ) {
        console.log(`buf.length > ${bufSize * bufMult - sofSize} and not sofFound, so aborting the SOF test and just pushing data to stream regardless. buf size: ${buf.length}`);
        sofFound = true;
        buf = [];
        srcIndexStart = 0;
      }
      console.log("sofFound: " + sofFound + " set pushStartIndex: " + pushStartIndex);

    } else {  // SOF has already been found
      ourReadableStreamBuffer.put(data);
    }


    /*if ( buf.length >= 2500 ) {
      console.log("buf.length: " + buf.length);
      mainWindowUpdateChartData(buf.slice(0,2499));
      buf = [];
    }*/


  });   // end dport.on('data'...)

  // Really for this to work, you need to:
  // Install the D2XX driver package
  // Install the D2XX helper package (if applicable)
  // kextunload the vcp driver (on Mac OS X anyway)
  // And then in the serial port list, your FTDI driver won't show (!)
  // But if you only have one FTDI device connected,
  // the stuff below works
  // And testing with OScope - yes, single bit is 12MHz time long
  // Or 6MHz clock cycle or so -- so we're in the right ballpark
  // We've updated the node-ftdi wrapper such that opening without a baudrate
  // and data format may give errors (as expected) to the console, but now
  // can return without error such that program execution continues -
  // because using this with eg async 245 fifo mode doesn't require that information
  // and futher that information has no meaning - so we only need the open call
  //
  // Thus even if using D2XX correctly, you will see output like:
  // Can't setBaudRate: FT_IO_ERROR
  // Can't Set DeviceSettings: FT_IO_ERROR
  //
  // This will be for any baud rate, and so far it is believed this is because
  // simply in a/sync 245 FIFO mode, these settings have no meaning
  // Rather data is just returned as clocked.
  // TODO Vfy clocking rate now with in-circuit usingHDL-0108-RSCPT Actual
  //
  // Again: settings now shown for concept, but regardless, opening with
  // any baud rate, even standard, will throw errors shown above just due to
  // irrelevance, it is thought ...
  /*var settings = {
    baudrate: 12000000, //57600, // either way, error(s) will be thrown at app log output (command line)
    databits: 8,
    stopbits: 1,
    parity  : 'none',
  };*/
  // Does this work for an async fifo style of data port, without any settings?
  // Works and still do get those open errors on termial console
  dport.open({ //{
    //baudrate: 12000000,
    //databits: 8,
    //stopbits: 1,
    //parity: 'none',
    //// bitmode: 'cbus', // for bit bang
    //// bitmask: 0xff    // for bit bang
    //settings
  });


  //});

}






var openDataPortVcp = function(portHash) {
  console.log("openDataPortVcp: " + JSON.stringify(portHash));

  var comName = getVcpPortNameFromPortInfoHash(portHash);

  // Please see Readme and elsewhere for discussion about Windows,
  // incl Win 10 Home/Pro and the need for baud rate aliasing
  // BTW see elsewhere notes here and in CCC FW regarding how
  // Targeting this baud on the CCC FW was updated, and one slightly faster
  // (within tolerance probably) clock on one board masked an issue of the
  // real symbol pulse width being -4.5% while on the slower board it was
  // more like -5.5% creating spikes in the data and corrupted SOF[1] typically,
  // causing loss of WF streaming sync / appropriate snipping out of the WFs
  let thisBaud = 2000000; // For Mac OS X at this moment we can use the direct 2Mbps baud rate
  // But for windows, we need to alias for reliable data
  // Directions for baud rate aliasing and related choices are in the Readme
  // At this time, we alias to 38400, a standard rate. Aliased to 2Mbps of course.
  if ( process.platform == "win32") {
    //thisBaud = 38400;
    thisBaud = 2000000; // Rememba why?
  }

  var settings = {
    autoOpen: false,
    baudRate: thisBaud, //2000000, //2000000, //1000000 // 1Mbps works too if f/w is updated to match
    databits: 8,
    stopbits: 1,
    parity  : 'none',
  }

  // TODO XXXX wrong sig?
  //dport = new SerialPort(comName, settings, function(err) { 
  settings.path = comName;
  dport = new SerialPort(settings, function(err) {
    if ( err ) {
      return console.error('sprenderer: openDataPortVcp: error on create new VCP style data port: ', err.message);
    }
  });

  dport.on('error', function(err) {
    console.error('dport.on error: ', err);
    // TODO -- UI error panel/log/indicator, etc.
  });

  dport.on('close', function(err) {
    console.log('dport.close event subscription ');
    /*console.timeEnd("timeOpen");
    console.log("samples collected: " + samples);
    const difftime = process.hrtime(time);
    // difftime contains [seconds, nanoseconds] difference from start time
    const nsps = 1e9; // nano sec per sec
    var dt_sec = difftime[0] + difftime[1]/nsps;
    var sps = samples / dt_sec;
    console.log(`Delta time by hrtime: ${dt_sec} seconds giving ${sps} samples per second for ${samples} samples.`);
    */

    $("#btnDataPortStatus").removeClass('green pulse').addClass('blue-grey');
    $("#btnListeningForData").removeClass('pulse').addClass('disabled');
    $("#btnSilenceIndicators").addClass('disabled');

    mainWindowUpdateChartData(null); // should call the cancel on the requestAnimationFrame

  });

  dport.on('open', function(err) {
    // TODO checkbox for run test on open
    //$("#serialPortGoButton").addClass("lighten-5");
    //$("#serialPortGoButton").removeClass("waves-light");
    //console.log(dport);
    $("#serialPortGoButton").addClass("red");
    $("#btnDataPortStatus").removeClass('hide blue-grey').addClass('green'); // TODO-TBD Used to have the pulse class set, removed for UI overlays TODO could make this conditional
    $("#btnListeningForData").removeClass('hide disabled').addClass('pulse');
    $("#active_ports_ui_status_indicators").removeClass('hide');
    $("#active_ports_ui_buttons").removeClass('hide');
    $("#btnSilenceIndicators").removeClass('disabled');
    console.log('dport.on open');
    //console.time("timeOpen");
    //time = process.hrtime();  // restart the timer, storing in "time"

    sofFound = false;

    mainWindowUpdateChartData(null); // init the loop for requestAnimationFrame

  });

  const sof = [0xaa, 0x55, 0xaa, 0x55, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0xff, 0x00];
  const sofSkipMatchByte = [ 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0];
  dport.on('data', function (data) {

    // Debugging the RS485 serial data
    // below shows that indeed in the _pool all of the data is present
    //console.log(dport);
    //console.log(data.length); // this shows correct number of iterative data receives and total number of samples
    //console.log("dport.on.data");

    var pushStartIndex = 0;

    if ( !sofFound ) {

      // Wait for and start dumping data on SOF found
      // SOF goes:
      // initial begin
      // sof[0] <= 8'h aa;
      // sof[1] <= 8'h 55;
      // sof[2] <= 8'h aa;
      // sof[3] <= 8'h 55;
      //
      // sof[8] <= 8'h ff;
      // sof[9] <= 8'h 00;
      // sof[10] <= 8'h ff;
      // sof[11] <= 8'h 00;
      // end

      console.log("looking for SOF (sofFound === false)");

      buf.push(...data);
      //console.log(buf); // this will just show the first data while sof is not found



      var sofSize = 12;
      var bufSize = 4095;
      const bufMult = 10;

      if ( buf.length > (sofSize -1) && buf.length < (bufSize * bufMult + 1 - sofSize) ) {

        var matchIndex = buf.indexOf(0xAA, srcIndexStart);
        console.log("matchIndex: " + matchIndex + " for srcIndexStart: " + srcIndexStart);

        if ( matchIndex > -1 ) {

          var stillGood = true;
          var i = 0;
          while ( stillGood  && ( i < sofSize ) ) {
            if ( !sofSkipMatchByte[i] ) {
              stillGood = buf[ matchIndex + i ] === sof[ i ];
            }
            i++;
          }

          console.log("stillGood: " + stillGood + " for i breaking out of while at: " + i);
          if ( stillGood ) {
            sofFound = true;
            pushStartIndex = matchIndex; // yes, we'll keep the SOF bytes in the graph output / buffer
            console.log("pushing starting from: " + pushStartIndex + " to stream buffer from source buffer of size: " + buf.length);
            var b = new Buffer.from(buf.slice(pushStartIndex));
            // Yes, we want to "put" a typeof Buffer here - otherwise weird behavior with current versions, perhaps all versions
            ourReadableStreamBuffer.put(b); //, buf.length));
            //console.log(buf.slice(pushStartIndex, buf.length));
            buf = [];
            srcIndexStart = 0; //??// already reset on each port open, so not needed?
          } else {
            srcIndexStart += i;
          }

        } else {  // match not found
          srcIndexStart += buf.length;
        }

      } else if ( buf.length > (bufSize * bufMult - sofSize) ) {
        console.log(`buf.length > ${bufSize * bufMult - sofSize} and not sofFound, so aborting the SOF test and just pushing data to stream regardless. buf size: ${buf.length}`);
        sofFound = true;
        buf = [];
        srcIndexStart = 0;
      }
      console.log("sofFound: " + sofFound + " set pushStartIndex: " + pushStartIndex);

    } else {  // SOF has already been found
      ourReadableStreamBuffer.put(data);
    }

    //console.log("sprenderer: ");
    //console.log(ourReadableStreamBuffer.size());

  });   // end dport.on('data'...)

  dport.open();

}







var getVcpPortNameFromPortInfoHash = function (infoHash) {

  // Updating to accommodate up to 4-port USB 485 converter eg

  let serialNumber = infoHash.serialNumber;
  let descrip = infoHash.description;

  if ( serialNumber.length <= 1 ) {
    console.warn(`getVcpPortNameFromPortInfoHash: this device probably enumerates without a serial number. 
      Auto-select serial port gets somewhat dumber. The auto-select may not work.  
      infoHash serial number is ${serialNumber}`);
  }

  //var serialNumberLessAorB = infoHash.serialNumber.substr(0, infoHash.serialNumber.length - 1);
  let seriesAlphas = ["A", "B", "C", "D"]; // serial number may end with any Alpha!
  let lastSerialNumberPlace = serialNumber.substr(serialNumber.length - 1, 1);
  if ( lastSerialNumberPlace.length < 1 ) {
    lastSerialNumberPlace = descrip.substr(descrip.length - 1, 1);
    serialNumber = lastSerialNumberPlace; // set this to reconstruct if there were an SN in this case
    console.log(`lastSerialNumberPlace is empty - likely serial number is empty - maybe \
    this is macosx and using a non-eeprom FTDI based USB 485 device?. Using description instead of serial number.`);
  }
  let serialNumberLessLastSeriesAlpha = serialNumber;
  // TODO some warnings are relevant here about serial number checks and what not
  if ( seriesAlphas.includes(lastSerialNumberPlace) ) {
    console.log(`
      serial number series alphabetic sequence indicator possibilities ${seriesAlphas} includes the current
      serial last place: ${lastSerialNumberPlace}
    `);
    serialNumberLessLastSeriesAlpha = serialNumber.substr(0, serialNumber.length - 1);
  }
  let isFullSerialNumber = serialNumber.length > 1 ? true : false;
  
  
  //var serialNumberWithAorB = infoHash.serialNumber;
  //var suffix = infoHash.serialNumber.substr(infoHash.serialNumber.length - 1, 1); // 5/29/21 why was this 2?
  //console.log("getVcpPortNameFromPortInfoHash: base serial number: " + serialNumberLessAorB + " with suffix found to be: " + suffix);
  console.log("getVcpPortNameFromPortInfoHash: base serial number: " + serialNumberLessLastSeriesAlpha + " with suffix found to be: " + lastSerialNumberPlace);

  // Another Windows scenario:
  // In the FTDI table, the two devices are listed as eg:
  // FT4MS1MKA/B
  // But in the top COM port table, A is only listed as the base FT4MS1MK
  // However, the pnpId column so far does contain the A/B along with much other chars
  // On Mac, the pnpId is empty
  // Either way, in the VCP table (not the FTDI table) the serial number will
  // show with the A/B so we can use that search item
  // Thus logic below until proven guilty:

  // Or simply just regex replace trailing A with 0 and trailing B with 1
  //var sn = infoHash.serialNumber.replace(/A$/,'0').replace(/B$/,'1');
  let snLastAlphaSwappedToNumber = serialNumber.replace(/A$/,'0').replace(/B$/,'1').replace(/C$/,'0').replace(/D$/,'1');
  console.log("getVcpPortNameFromPortInfoHash: regexd last digit swap from alpha to numeric: " + snLastAlphaSwappedToNumber);

  // On MAC OS X so far, the A or B trailing is replaced by corresponding 0 or 1
  // div class cv contains text
  // If using like US Converters dual 485/USB converter there is no EEPROM and 
  // no serial number (although U4 is DNP and may be the missing EEPROM FP)
  // and so we just get like 0 or 1 here.  So using the previous logic 
  // below we would get qty 2 of the $(t) like [.cv].length == 2
  // so we can sub the logic - update it to endswith:
  //var t = $('#vcp_ports').find("td[data-header='comName']").find(".cv:contains('" + sn + "')");
  let matchingComPorts =  $('#vcp_ports')
    //.find("td[data-header='comName']") // old was comName - now is path
    .find("td[data-header='path']")
    .find(`.cv`);
  // matchingComPorts = $('#vcp_ports')
  //   .find("td[data-header='comName']")
  //   .find(`.cv`)
  //   .filter( function() { 
  //     return $(this).text().endsWith(snLastAlphaSwappedToNumber); 
  //   });
  // console.log("Number of VCP comNames matching the selected control port serialNumber: " + matchingComPorts.length);

  // Now we always just initialize like above - so there should be multiples
  // if ( matchingComPorts && matchingComPorts.length != 1 ) {
  //   console.warn(`
  //     for serial number ${snLastAlphaSwappedToNumber} there are 
  //     ${matchingComPorts.length} matching .cv cells in the table, 
  //     in this function really we want just 1.}
  //   `);
  //   console.warn(matchingComPorts);
  //   // but as of now just let it ride aka don't return
  // }

  // WINDOWS WIN32
  // Win work around, as described above
  // Prior logic - matchingComPorts.length == 0 meant likely Win Platform - now do explicitly
  // if ( matchingComPorts && matchingComPorts.length == 0 ) {
  //   console.log(`t.length is 0 for ${serialNumberLessAorB} - maybe this is Windows? Checking pnpId column...`);
  //   if ( !suffix.match(/[A-B]/) || (process.platform == "win32") ) {
  //     console.log(`yeah, suffix is not A or B, or process.platform is win32 ... seems probable...full serial number with suffix: ${serialNumberWithAorB}`);
  //     t = $('#vcp_ports').find(".cv:contains('" + serialNumberWithAorB + "')").closest("tr").find("td[data-header='comName']").find(".cv");
  //     console.log("2nd tier: number of VCP comNames matching the selected control port serialNumber: " + t.length);
  //     if ( t.length > 1 && serialNumberWithAorB.length <= 1 ) {
  //       // no actual SN - just A or B - device does not have a serial number
  //       // again for the eg US Converter dual USB 485 w/o EEPROM and so no serial number
  //       console.log("3rd tier: serialNumberWithAorB A or B and no serial number - swapping A/B for 0+1/1+2 = 1/2 as suffix for PnPId table");
  //       t = $('#vcp_ports').find(".cv:contains('" + serialNumberWithAorB + "')")
  //         .filter( function () { 
  //           return $(this).text().endsWith(`&${parseInt(sn)+1}\\0000`); 
  //         })
  //         .closest("tr").find("td[data-header='comName']").find(".cv");
  //       console.log("t is: ");
  //       console.log(t);
  //     }
  //   }
  // }

  // Non-Win
  if ( process.platform != "win32" ) {
    matchingComPorts = $('#vcp_ports')
    //.find("td[data-header='comName']") // old was comName - now path
    .find("td[data-header='path']")
    .find(`.cv`)
    .filter( function() { 
      return $(this).text().endsWith(snLastAlphaSwappedToNumber); 
    });
    console.log(`Number of VCP comNames matching the selected control port serialNumber ${serialNumber}: ` + matchingComPorts.length);
  }

  // Win
  if ( process.platform == "win32" ) {
    console.log(`looks like win32 ... trying to auto match for serial number ${serialNumber}`);
    // If a real serial number then likely the whole serial number should match narrowing this down to one item
    if ( isFullSerialNumber ) {
      matchingComPorts = $('#vcp_ports')
        .find(".cv:contains('" + serialNumber + "')")
        //.closest("tr").find("td[data-header='comName']").find(".cv"); // old was comName now is path
        .closest("tr").find("td[data-header='path']").find(".cv");
    } else {
      matchingComPorts = $('#vcp_ports')
        .find(".cv:contains('" + serialNumber + "')")
        .filter( function () { 
          return $(this).text().endsWith(`&${parseInt(snLastAlphaSwappedToNumber)+1}\\0000`); 
        })
        //.closest("tr").find("td[data-header='comName']").find(".cv"); // old was comName now is path serialport 10.x
        .closest("tr").find("td[data-header='path']").find(".cv");
    }
  }

  console.log("comName / path is chosen as: " + $(matchingComPorts).text());

  return $(matchingComPorts).text();

}







// Below for FTDI D2XX - for the control port (serial style, but likely still under d2xx/ftdi)
// ok or now includes VCP implementation as well for control port
var openControlPort = function(portHash) {

  console.log("openControlPort: portHash: " + JSON.stringify(portHash));

  //console.log("Prior, openControlPort used the FTDI device to open the control port.");
  //console.log("However, there are wrapper/driver errors and this is not reliable.");
  //console.log("Thus, we are now using and require VCP access to the control port.");

  // When using VCP driver access (serial port, etc.) for control port:
  //*

  // When listed in the FTDI device section, the serialNumber, less the trailing
  // A or B matches the serialNumber as listed in the VCP listing.
  // However, in the VCP listing, the locationId doesn't match the FTDI device
  // locationId, and the serialNumber is the same for both instances in the VCP
  // listing.
  // It is the VCP listing comName that differentiates the two sections of the
  // device, for Mac OS X anyway.
  // VCP instance, Mac OS X: /dev/tty.usbserial-serialNumber0/1 where the last
  // digit corresponds to A or B in the serialNumber for the FTDI device listing.

  var comName = getVcpPortNameFromPortInfoHash(portHash);
  //var byteCount = 0;

  console.log("openControlPort: " + "opening hardware from hardwareOptions (hardwares.json): " + JSON.stringify(hw));

  var settings = {
    autoOpen: false,
    //baudRate: 912600, //57600, //9600, //57600, //921600, //57600, // Q3 2021 GXN from Customer set to 912600
    baudRate: hw.controlPortBaudRate,
    databits: 8,
    stopbits: 1,
    parity  : 'none',
  };

  // for 10.x serialport
  settings.path = comName;

  console.log("openControlPort: settings: " + JSON.stringify(settings));

  //cport = new SerialPort(comName, settings, function (err) { // old
  cport = new SerialPort(settings, function(err) { // serialport 10.x
    if ( err ) {
      return console.log('sprenderer: openControlPort: error on create new VCP style control port: ', err.message)
    }
  });
  
  cport.on('error', function(err) {
    console.log('cport.on error: ', err);
    // TODO -- UI error panel/log/indicator, etc.
  });
  
  cport.on('close', function(err) {
    console.log('cport.on close');
    $("#btnControlPortStatus").removeClass("green").addClass('blue-grey');
    $("#controlPortOpenBtn").prop('disabled', false);
    $("#controlPortCloseBtn").prop('disabled', true);

    // TODO - hardware update complete for DL force retrofit
    mainWindowUpdateChartData(null); // should cancel requestAnimationFrame
  });
  
  cport.on('open', function() {
    console.log('cport.on open');
    $("#btnControlPortStatus").removeClass('hide blue-grey').addClass('green');
    $("#activeControlPortName").text(getSelectedControlPortInfoHash().description);
    $("#controlPortOpenBtn").prop('disabled', true);
    $("#controlPortCloseBtn").prop('disabled', false);

    // When serial port is for both data and control aka a single port 
    if (hw.dataPortType.includes("SameAsControl")) {
      console.log("openControlPort: singular serial port (same one for data and control), enabling all control port functions.");
      $("#serialPortGoButton").addClass("red");
      $("#btnDataPortStatus").removeClass('hide blue-grey').addClass('green'); // TODO-TBD Used to have the pulse class set, removed for UI overlays TODO could make this conditional
      $("#btnListeningForData").removeClass('hide disabled').addClass('pulse');
      $("#active_ports_ui_status_indicators").removeClass('hide');
      $("#active_ports_ui_buttons").removeClass('hide');
      $("#btnSilenceIndicators").removeClass('disabled');
    }

    // TODO - update for hardware ID - adding this here just to force display of updated data from the 
    // DL retrofit
    // If hardware uses only a single com port for both control and data like the DL-Family, then 
    // the cport item here should call this.  But if the hardware uses a data port and a control port 
    // then only the dport open should call this - otherwise this calls the init twice starting and then stopping 
    // the graph updates.
    if (hw.dataPortType.includes("SameAsControl")) {
      mainWindowUpdateChartData(null); // init the loop for requestAnimationFrame
    }

  });
  
  cport.on('data', function (data) {

    // TODO eventually we move this from console (the WF buffer output)
    console.log ("cport.on data");
    console.log(data);
    var retD = hexBufToAscii(data);
    console.log(retD);
    
    //byteCount += data.length;
    //console.log(byteCount);
    // TODO refactor this 
    if ( hw && hw.dataPortType.includes("SameAsControl") ) {

      if ( gReturnDataTo === "console") {
        // Added to show data always for cport recieve in the UI display of text reply
        //showControlPortOutput(retD); 
        $('#cmdOutput').append(retD+"\r\n"); // Device using SameAsControl lack a termination char?
        // TODO add div id for below - so only this one item does this if add more like it in the future
        $('pre.mini').scrollTop($('pre.mini').prop("scrollHeight"));
      } else {
        ourReadableStreamBuffer.put(data);
      }
    } else {
    
      console.log("Same data parsed as ASCII chars: ");
      var retD = hexBufToAscii(data);
      console.log(retD);
      showControlPortOutput(retD);

    }

  });

  cport.open()

  //*/ // Above section: when using VCP driver access for control port

  // When using FTDI device wrapper for the Control Port, use section next below:
  /*
  cport = new Ftdi.FtdiDevice({
    locationId: portHash.locationId,
    serialNumber: portHash.serialNumber }); // for d2xx only

  cport.on('error', function(err) {
    console.log('cport.on error: ', err);
    // TODO -- UI error panel/log/indicator, etc.
  });
  cport.on('close', function(err) {
    console.log('cport.on close');
    $("#btnControlPortStatus").removeClass("green").addClass('blue-grey');
    $("#controlPortOpenBtn").prop('disabled', false);
  });
  cport.on('open', function(err) {
    // TODO set up div or button to indicate active connection
    //$("#serialPortGoButton").addClass("red");
    console.log('cport.on open');
    $("#btnControlPortStatus").removeClass('hide blue-grey').addClass('green');
    $("#activeControlPortName").text(getSelectedControlPortInfoHash().description);
    $("#controlPortOpenBtn").prop('disabled', true);
    //console.log(getSelectedControlPortInfoHash().description);
  });
  cport.on('data', function (data) {
    console.log ("cport.on data");
    console.log(data);
  });
  */ // End of cport using FTDI Device wrapper/driver

  // Really for this to work, you need to:
  // Install the D2XX driver package
  // Install the D2XX helper package (if applicable)
  // kextunload the vcp driver (on Mac OS X anyway)
  // And then in the serial port list, your FTDI driver won't show (!)
  // But if you only have one FTDI device connected,
  // the stuff below works
  // And testing with OScope - yes, single bit is 12MHz time long
  // Or 6MHz clock cycle or so -- so we're in the right ballpark
  // We've updated the node-ftdi wrapper such that opening without a baudrate
  // and data format may give errors (as expected) to the console, but now
  // can return without error such that program execution continues -
  // because using this with eg async 245 fifo mode doesn't require that information
  // and futher that information has no meaning - so we only need the open call
  //
  // Thus even if using D2XX correctly, you will see output like:
  // Can't setBaudRate: FT_IO_ERROR
  // Can't Set DeviceSettings: FT_IO_ERROR
  //
  // This will be for any baud rate, and so far it is believed this is because
  // simply in a/sync 245 FIFO mode, these settings have no meaning
  // Rather data is just returned as clocked.
  // TODO Vfy clocking rate now with in-circuit usingHDL-0108-RSCPT Actual
  //
  // Again: settings now shown for concept, but regardless, opening with
  // any baud rate, even standard, will throw errors shown above just due to
  // irrelevance, it is thought ...

  /*
  var settings = {
    baudrate: 57600, // either way, error(s) will be thrown at app log output (command line)
    databits: 8,
    stopbits: 1,
    parity  : 'none',
  };

  cport.open({ //{
    //baudrate: 12000000,
    //databits: 8,
    //stopbits: 1,
    //parity: 'none',
    //// bitmode: 'cbus', // for bit bang
    //// bitmask: 0xff    // for bit bang
    settings
  });
  */

} // end of: openControlPort()







// TODO move to utils
// https://www.w3resource.com/javascript-exercises/javascript-string-exercise-28.php
function hexBufToAscii (dataAsHexBuf) {
	var str = '';
	for (var n = 0; n < dataAsHexBuf.length; n++) {
		str += String.fromCharCode(parseInt(dataAsHexBuf[n]));
	}
	return str;
}








var serialClose = function () {
  if ( port ) port.close ( function (err) {
    console.log('port.close called')
    if ( err) {
      return console.log('sprenderer: error on close: ', err.message)
    }
  });
}







var controlPortClose = function() {
  //console.log("controlPortClose");
  if ( cport ) cport.close ( function (err) {
    console.log ('controlPortClose called');
    if ( err ) {
      return console.log('sprenderer: error on cport close: ', err.message);
    }
  });
}








var controlPortOpen = function() {
  // [0.0.12] This is only called from the custom control button "Open"
  // with the custom controls loaded standard buttons and generic send tool section
  openControlPortThatIsChecked();
  console.warn("WARNING: sprenderer.js controlPortOpen() just called openControlPortThatIsChecked() without setTimeout. Is this working correctly?");
  // TODO: But this isn't called for RS104
  // Is it for RS8? (RS108)
  // In customized code one user found this helpful in the real world:
  // console.warn("PREFS");
  // console.log(prefs);
  // setTimeout( function() { openControlPortThatIsChecked() }, 1000 );
}







var serialCheckbox = function (checkbox) {

  // Uncheck all other checkboxes in this column
  // Function can be called without a param like serialCheckbox();
  if ( checkbox ) {
    if ( checkbox.id.indexOf("Data") > -1 ) {
      $("[id^=UseForData][type=checkbox]").not($(checkbox)).filter(":checked").prop('checked', false);
    }
    if ( checkbox.id.indexOf("Control") > -1 ) {
      $("[id^=UseForControl][type=checkbox]").not($(checkbox)).filter(":checked").prop('checked', false);
    }
  }

  guessAndSetHardwareIdentity();

  console.log(hw)

  // Check that one data and one control port are selected
  var nDataChecked = $("[id^=UseForData][type=checkbox]:checked").length;
  var nControlChecked = $("[id^=UseForControl][type=checkbox]:checked").length;

  var enableConnect = false;

  var enablePorts = false;

  // TODO we should move the functionality for auto-checked data/control boxes to this position here 


  // Currently, if these were already checked in the first device enumeration (ftdiFind)...
  if ( nDataChecked === 1 && nControlChecked === 1 ) {

    enablePorts = true;

  }
  if ( nDataChecked === 0 && nControlChecked === 0 ) {

    // For only DL hardware connected, these won't be checked, so check them here 
    // and yeah for now only do this if 2 other checkboxes aren't already checked above 
    // TODO This is clunky and needs to be refactored yet again ...
    // Issue: if there are multiple serial devices and you uncheck an active one that you don't 
    // want then this rechecks it anyway - for any device
    if ( hw && hw.numberOfMatchingComPorts === 1) {
      console.log("No data and no control port checked, and, hw guessed as a match and numberOfMatchingComPorts === 1, so checking data and control for one com port.");
      var tr = $("[id^=ftdi_ports]").find("td[data-header='description']").find(".cv:contains(" + hw.comPortDeviceIdTextTypicallyContains + ")").closest("tr");
      $(tr).find("input").prop("checked", "checked"); // check both boxes
      enablePorts = true;
    }

  }

  if ( enablePorts ) {

    console.log( "Ok, one data and one control port selected.");
    // Now populate/show/enable the "Go" button to open ports and prep
    var h = `<button id="serialPortGoButton" class="waves-effect waves-light btn-large" onclick="beginSerialComms(this)"><i class="material-icons left">device_hub</i>Connect to Ports and Begin Listening for Data</button>`;
    $('#ports_go_button').html(h).removeClass('hide');
  
  } else {
  
    // If nothing found, indicate the situation
    // Was: or optionally:
    //$('#ports_go_button').addClass('hide');
    // Now we indicate the situation and leave the button there
    $('#portsGoButtonInactive')
      .addClass("brown lighten-3")
      .removeClass("disabled pulse")        // Remove disabled so we can apply color
      .css( "line-height", "18px" )
      .css( "pointer-events", "none")       // Make it act like a disabled button
      .text("Ports couldn't be auto-selected. If you see them listed, you can select them manually... Or Plug-In/Re-Plug and Reload?");
  
  }

} // end of: serialCheckbox



// Already included above:
//const fs = require('fs');
const hardwareOptions = require("./user-data/hardwares.json").hardwares;
var hwTxt = "Undetermined"; // TOOD this is probably the wrong place for this - probably a hardware class would be good right?
var hw;



var guessAndSetHardwareIdentity = function() {

  console.log("Guessing hardware ID (using last one in hardwares.json list that matches): ");

  // TODO CONDITIONS:
  // Logic doesn't work correctly yet in the following example cases:
  // - There are two different single serial port devices and control is checked for one and data is checked for the other
  // 
  $("#hardware-id").text("Undetermined");

  // If none are checked, look at possibilities 
  // If some are checked, use the checked values
  var nChecked = $("[id^=ftdi_ports]").find("input:checkbox:checked").length;
  if ( nChecked === 1 ) {
    console.log("nChecked is === 1, returning. Would proceed if zero checked or 2 checked.");
    return;
  }
  var useOnlyChecked = nChecked > 1;
  const maxComs = 2; // TODO-4CHANNEL?
  
  var hwCount = 0;
  var hws = [];
  var hwTxts = [];
  hardwareOptions.forEach(function (h) {
    var txt = h.comPortDeviceIdTextTypicallyContains
    var descrips = $("[id^=ftdi_ports]").find("td[data-header='description']").find(".cv:contains(" + txt + ")");
    //var rowIsChecked = descrips.closest('tr').find("input:checkbox:checked"); // even if the same row, two checks will return array of 2 input checkboxes
    // Below is actually matching rows with checks, might not include check(s) in non-matching descrip row
    var matchingRowsWithChecks = descrips.closest('tr').find("input:checkbox:checked").closest('tr'); // same row, length = 1
    var checkedBoxesInMatchingRows = descrips.closest('tr').find("input:checkbox:checked");
    // If 2 matching com ports spec'd, then there should be 2 rows matching
    // If 1 matching com port spec'd, then there should be 1 row matching with 2 checks
    // We are only here in the code if we have two checks overall, matching a hw spec or not
    // 
    console.log(`Looking for ${txt}...`);
    //if ( descrips.length === h.numberOfMatchingComPorts ) {
    // https://stackoverflow.com/questions/9973323/javascript-compare-3-values
    //if ( (new Set([ descrips.length, rowIsChecked.length, h.numberOfMatchingComPorts])).size === 1 ) {
    var pushTheHw = false;
    // Probably these is some very pretty way to do this
    console.log(`descrips.length: ${descrips.length}`);
    console.log(`matchingRowsWithChecks.length: ${matchingRowsWithChecks.length}`);
    console.log(`h.numberOfMatchingComPorts: ${h.numberOfMatchingComPorts}`);
    if ( useOnlyChecked ) {
      pushTheHw = (new Set([ descrips.length, matchingRowsWithChecks.length, h.numberOfMatchingComPorts])).size === 1
        && checkedBoxesInMatchingRows.length === maxComs;
    } else {
      pushTheHw = descrips.length === h.numberOfMatchingComPorts;
    }
    if ( pushTheHw ) {
      console.log("Found " + h.numberOfMatchingComPorts + " of " + txt + " in the device descriptions ... assuming " + h.shortname);
      hwTxt = `${h.fullname} (${h.shortname})`;
      hwTxts.push(hwTxt); // TODO
      hw = h;
      hws.push(h); // TODO
      hwCount++;
    } else {
      console.log(`... none found in quantity ${h.numberOfMatchingComPorts}`);
    }
  });

  if ( hwCount > 1 ) {
    console.warn(`On guessing at connected hardware, there was more than 1 match. Maybe you have multiple devices connected, or other USB devices connected. At this time, this behavior is undefined. Last match is shown as HARDWARE IS: but the checkboxes will be set an HDL 4 or 8 channel series if present. This is one among many TODOs`);
  
    // TODO TEMP: Select the first one matched instead
    console.warn("TODO: Actually, currently selecting the first match");
     $("#hardware-id").text(hwTxts[0]);
     hw = hws[0];
  }
  
  // TODO 
  if ( hwCount == 1) {
    $("#hardware-id").text(hwTxt);
  }

  

} // end of: guessAndSetHardwareIdentity








var setHardwareByFullname = function(fullname) {

  console.log(`setHardwareByFullname: (try) ${fullname}`);

  // Commenting so as not to change previous if failure here (?) TODO REVISIT
  //$("#hardware-id").text("Undetermined");

  if ( fullname ) {
    hardwareOptions.forEach(function (h) {
      if ( h.fullname === fullname ) {
        hw = h;
        hwTxt = `${h.fullname} (${h.shortname})`;
        $("#hardware-id").text(hwTxt);
      }
    })
  }

} // end of setHardwareByFullname()










var setupModalHardwareSelect = function() {
  
  let ele = $('#modal-hardwareSelect > .modal-content');
  ele.empty();
  ele
    .append(
      $('<h6>').text(`Hardwares.json options available: ${hardwareOptions.length}`)
    )
    ;

  hardwareOptions.forEach( ho => {
    let checkedText = null;
    if ( typeof hw !== 'undefined' && hw ) {
      if ( hw.fullname === ho.fullname ) {
        checkedText = "checked"
      }
    }
    let s = $('<span>').text(ho.fullname);
    let c = $('<input />', {type: 'checkbox', checked: checkedText});
    let l = $('<label>');
    $(l).click( function() {
      modalHardwareSelectToggleChecks(this); // defined in mainWindows.html; this is now the label containing the checkbox
    })
    l.append(c).append(s);
    ele 
      .append(
        $('<p>')
          .append( l )
      )
      ;
  });
  

} // end of: setupModalHardwareSelect






var getSelectedDataPortInfoHash = function() {
  return checkboxToPortHash($("[id^=UseForData][type=checkbox]:checked"));
}








var getSelectedControlPortInfoHash = function() {
  return checkboxToPortHash($("[id^=UseForControl][type=checkbox]:checked"));
}








// Dual-port device style port opening
// Make not anonymous declaration - moving mainWindow JS to external file
//var beginSerialComms = function(button) {
function beginSerialComms(button) {
  // make hash for port ID for data and call that function
  //var dataPortHash = checkboxToPortHash($("[id^=UseForData][type=checkbox]:checked"));
  //openDataPort(dataPortHash);
  openDataPortThatIsChecked();

  // make hash for control port (serial) ID and call that function
  //var controlPortHash = checkboxToPortHash($("[id^=UseForControl][type=checkbox]:checked"));
  //openControlPort(controlPortHash);
  //openControlPortThatIsChecked();
  // vvvv
  // User report: this was necessary: (not sure of conditions)
  console.log(`openControlPortThatIsChecked() via setTimeout with delay ${prefs.delayControlPortOpenMs}`);
  setTimeout( function() { openControlPortThatIsChecked() }, prefs.delayControlPortOpenMs );


  // Then collapse the selection window ...
  $("#serialPortSelectionAccordion").collapsible('close'); //.children('li:first-child'));

  // Enable anything else if/as needed, esp. in the UI/UX - here, the selected interface
  // including potentially the data-capture-focused UI/UX
  // This instance variable, YouFace, comes from mainWindow.html
  YouFace.Ready();

}








var openControlPortThatIsChecked = function() {
  // make hash for control port (serial) ID and call that function
  var controlPortHash = checkboxToPortHash($("[id^=UseForControl][type=checkbox]:checked"));
  openControlPort(controlPortHash);
}








var openDataPortThatIsChecked = function() {
  var dataPortHash = checkboxToPortHash($("[id^=UseForData][type=checkbox]:checked"));
  openDataPort(dataPortHash);
}








var checkboxToPortHash = function(checkbox) {
  var r = {};
  r.serialNumber = $(checkbox).attr('tag');
  //console.log("CAUTION: Is the locationId always numeric across platforms? Or do we need to differentiate UseForControl vs UseForData");
  // Now, just grab if this is Data or Control and grab the location Id info after that from the ID
  var ptype = $(checkbox).siblings('span').text();
  //var locId = $(checkbox).attr('id'); // prior: this worked when locationId was embedded in the id
  // however the id method for extracting locId didn't work for RS8 for FTDI D2XX driver 
  // when the appended index update was added for RS104 -- see the label for creation update there 
  // regarding adding the data-locationid attribute 
  var locId = $(checkbox).parent("label").attr("data-locationid");
  // Was used when extracting location from id:
  //r.locationId = locId.substr(locId.indexOf(ptype)+ptype.length);
  r.locationId = locId;
  r.description = $(checkbox).attr('name');
  console.log(`checkbox to port hash:`);
  console.log(JSON.stringify(r));
  return r;
}









var serialTestWrite = function () {
  if ( port ) {
    /*var size = 10;
    var buffer = new Buffer(size);
    var i = 0;
    for (i=0; i<size; i++) {
      buffer[i] = 0xaa;
    }*/
    var cmd = [ 0x53, 0xC1, 0x00, 0x00, 0x50 ]; // Get Test WF (vs C4 01 is PAQ from RAM)
    //port.write('Testing123', function (err) {
    //port.write(buf, function (err) {
    port.write(cmd, function (err) {
      if ( err ) {
        console.log('sprenderer: error on write: ', err.message)
      }
    });
  }
}








var controlPortSendStuff = function (textInput) {
  //console.log(textInput);
  var t = $(textInput).val();
  //console.log("controlPortSendStuff: t: " + t);
  if ( cport ) {
    cport.write(t);
    /*$(textInput).text().split('').forEach(function(c) {
      cport.write()
    });*/
  } else {
    console.log("I'd really like to help you man, but cport is not a thing, so can send stuff through it ...");
    console.log("I'd really like to help you man ...");
  }
}










var serialSendData = function ( commandAndType, returnDataTo) {
  if ( port ) {
    var cmdarr = [];
    // Warning: there needs of course to be some kind of limits and sanity
    // checking structure -- length of commands, etc.
    // This could be a separate structure that is required with an imported
    // command set such that validation occurs within this ruleset prior to
    // allowing execution
    switch ( commandAndType.type ) {

      case "hexCsvBytes":
        var cmd = commandAndType.value.replace(/\s/g,"").split(',');
        var cmdarr = [];
        cmd.forEach(function(c) {
          cmdarr.push(parseInt(c));
        });
        console.log(cmdarr);
        port.write(cmdarr, function (err) {
          if ( err ) {
            console.log('sprenderer: error on write within serialSendData: ', err.message)
          }
        });
        break;

      case "hexCsvBytesChained":
        var delayBwCalls = parseInt(commandAndType.chainedCmdDelayMs);
        var responseTimeout = parseInt(commandAndType.chainedCmdTimeoutMs);
        var responseTermChar = commandAndType.chainedCmdCompleteChar;
        if ( delayBwCalls ) {
          // Use
          var totTimeout = 0;
          var len = commandAndType.value.length;
          console.log("hexCsvBytesChained: " + len + " commands found ...");
          commandAndType.value.forEach ( function (catv, index) {
            var cmd = catv.replace(/\s/g,"").split(',');
            var cmdarr = [];
            cmd.forEach(function(c) {
              cmdarr.push(parseInt(c));
            });
            setTimeout( function () {
              console.log("Firing command " + (index + 1) + " of " + len);
              console.log(cmdarr);
              port.write(cmdarr, function (err) {
                if ( err ) {
                  console.log('sprenderer: error on write within serialSendData: ', err.message)
                }
              });
            }, totTimeout, index, len, cmdarr);
            totTimeout += delayBwCalls;
            console.log("Total timeout: " + totTimeout);
          });
        } else
        if ( !delayBwCalls && ( responseTimeout && responseTermChar ) ) {
          // Is arguments.callee.name deprecated or not?
          console.log(arguments.callee.name + ": hexCsvBytesChained with sequenced cmds issued and termination of each stage based on response termination character or response timeout");
          // See above - parsers requires a new serialport
          //const parser = port.pipe(new Delimiter({ delimiter: '\n'}));
          //parser.on('data', console.log);
        }
        break;
        // End case: hexCsvBytesChained

      default:
        console.log('sprenderer: error on serialSendData: type in command with type is not (yet) supported: ' + commandAndType.type);
    }



  } else {  // if not port ...
    console.log ('sprenderer: error on serialSendData: port does not yet exist or has not been opened');
  }

}










var showControlPortOutput = function ( asciiStuff ) {
  //console.log("showControlPortOutput called");
  $('#cmdOutput').prepend(asciiStuff); // or prepend()
  // nogo ... :
  //$('#cmdOutput').scrollTop($('#cmdOutput').prop("scrollHeight"));
}










var executingTimeoutFcns = [];
var controlPortSendData = async function ( commandAndType, returnDataTo, button, outputDirectory ) {

  // TODO REFINE This is a scary long function

  console.log("controlPortSendData");

  if ( cport ) {

    var cmdarr = [];

    // TODO Warning: there needs of course to be some kind of limits and sanity
    // checking structure -- length of commands, etc.
    // This could be a separate structure that is required with an imported
    // command set such that validation occurs within this ruleset prior to
    // allowing execution

    // Switch structure here for more complex possibilities --
    // if none, could condense quite a bit
    if ( returnDataTo ) {
      switch ( returnDataTo ) {
        case "chart":
          // Currently, if dport is open, mainWindowUpdateChartData will have
          // already been called thus setting up the charts or multicharts
          // for the render loops -- if the chart type has changed we need to cycle
          // this -- so the assumption is that calling it twice will cancel and
          // then restart the render loops with the new gReturnDataTo value
          // Obviously, this can be encapsulated and cleaned up
          // Quick demo fix ... :
          if ( gReturnDataTo !== returnDataTo ) {
            mainWindowUpdateChartData(null);
            gReturnDataTo = "chart";
            console.log("Switched gReturnDataTo to chart");
            mainWindowUpdateChartData(null);
          }
          // Placeholder for more complex actions
          break;

        case "multiChart":
          // Quick demo fix ... :
          if ( gReturnDataTo !== returnDataTo ) {
            mainWindowUpdateChartData(null);
            gReturnDataTo = "multiChart";
            console.log("Switched gReturnDataTo to multiChart");
            mainWindowUpdateChartData(null);
          }
          break;

        case "console":
        case "log":
          if ( gReturnDataTo !== returnDataTo ) {
            gReturnDataTo = "console";
            console.log("Switched gReturnDataTo to console");
          }
          break;

        default:
          console.log("controlPortSentData: unhandled returnDataTo case: " + returnDataTo);
          break;
      }
    }

    //console.log(button.options);
    //var cancelThis = false;
    var doFileCapture = false;
    var doFileCaptureCustomToDirectory = false;
    var captureSizeBytes = null;
    var captureSizeNumberOfWaveformsPerFile = null;
    var commandReplyTimeoutMs = 500; // 500 ms default
    if ( button.options ) {
      button.options.forEach( function(o) {
        switch ( o.key ) {
          case "replyTimeoutMs":
            console.log("parsed command replyTimeoutMs " + o.value + " with button.option note: " + o.note);
            commandReplyTimeoutMs = o.value;
            break;
          case "singleCaptureBuffer":
            //console.log("button option: singleCaptureBuffer is " + o.value);
            // TODO this is poor compartmentalized coding - this fcn is in the
            // mainWindow.html at the moment
            // Anyway, reset and just use a single chunksize buffer
            resetReadableStream(1);

            // TODO also flush / empty the serial port if possible?
            // cport is what type of port to check API for this?
            // console.log("about to cport.flush()...");
            // cport.flush(function(err,results){}); // recreate and test by setting next timeout below from 2000 to like 500 again 
            // with radio on DL0100A1 for WF in noisy RF setting
            // But not do this above - async / await or somewhere else etc 
            // where natural pause - seems to interfere with ops if here
            
            // If readable stream is finished, but buffer isn't quite full, there will
            // be nothing chunked out to pushed the readable event.  This might matter
            // for non-standard hardware, hardware in dev, or some scenario where not
            // all data is getting through, or some other test mode.  Hence:
            //if ( chunkMultiple == 1 ) {
              setTimeout( function() {
                if ( ourReadableStreamBuffer.size() < ourReadableStreamBuffer.chunkSize() ) { //ourReadableStreamBuffer.chunkSize ) {
                  console.log( "mainWindow: ourReadableStreamBuffer.size()" + ourReadableStreamBuffer.size() + " is less than chunkSize " + ourReadableStreamBuffer.chunkSize() );
                  if ( ourReadableStreamBuffer.size() < 1 ) {
                    console.log("... looks like we got some dribble ... probably a CCC firmware DEV TODO ");
                  } else {
                    console.log ( "Appending zero data to push data to chart...");
                    // BTW
                    // https://stackoverflow.com/questions/1295584/most-efficient-way-to-create-a-zero-filled-javascript-array
                    // See speed comparison entry circa 2020
                    let n = ourReadableStreamBuffer.chunkSize() - ourReadableStreamBuffer.size();
                    //let a = new Array(n);
                    //for (let i=0; i<n; ++i) a[i] = 0;
                    let a = Buffer.alloc(n, 0);
                    console.log("adding " + n + " elements ...");
                    ourReadableStreamBuffer.put(a);
                    console.log("ourReadableStreamBuffer.size(): " + ourReadableStreamBuffer.size());
                  }
                }
              }, commandReplyTimeoutMs); // 500); // was 500 - but cutting short cont PAQ 2nd Start Req for DL0100A1
              // 2023 Q1 lengthened to 2000 in DL0100A1 radio testing was getting some long WF 
              // transmission times ... TODO make configurable?  Based on the hardware?
              // But right that 2000 delays a long WF single grab for the HDL like that comes back 4094 instead of 4095 

            //}

            break;

          case "captureBufferMultiple":
            resetReadableStream(parseInt(o.value));
            break;

          case "captureSizeBytes":
            captureSizeBytes = parseInt(o.value.number);
            break;

          case "captureSizeNumberOfWaveformsPerFile":
            captureSizeNumberOfWaveformsPerFile = parseInt(o.value.number);
            break;

          case "fileCapture":
            doFileCapture = o.value;
            break;

          case "fileCaptureCustomToDirectory":
            doFileCaptureCustomToDirectory = o.value;
            break;

          default:
            console.log("controlPortSendData: Unrecognized button option: " + o.key);
        }
      });
    }

    // Done parsing button options, now run any setups if needed with the
    // garnered items

    if (!doFileCapture && !doFileCaptureCustomToDirectory ) {
      console.log("Neither file capture setup nor capture custom to files is selected. First controlPortSendData_SetupAndSendCommands about to be called");
      controlPortSendData_SetupAndSendCommands(commandAndType);
    }

    if ( doFileCapture || doFileCaptureCustomToDirectory ) {

      // https://electronjs.org/docs/api/dialog

      if ( doFileCapture) {
        currentWriteStreamFilepath = dialog.showSaveDialog( {
          //options : {
            title : 'Create your destination captured data file ...',
            buttonLabel: 'Start Capture'
          //}
        });
        console.log("file picker result: " + currentWriteStreamFilepath);
      }

      var captureDataFileOutputDirectory;
      if ( doFileCaptureCustomToDirectory ) {
        if ( outputDirectory ) {
          // For example if output directory already selected in the batch
          // capture user interface modality
          captureDataFileOutputDirectory = outputDirectory;
          console.log(`Output directory: ${captureDataFileOutputDirectory} already selected. No need to prompt for directory selection.`);
        } else {
          captureDataFileOutputDirectory = dialog.showOpenDialog( {
            title : 'Select and/or create your captured data directory ...',
            buttonLabel: 'Start Capture to this Directory',
            properties: [ 'openDirectory', 'createDirectory']
          });
          console.log("file picker result: " + captureDataFileOutputDirectory);
        }
      }

      if ( !captureDataFileOutputDirectory && !currentWriteStreamFilepath ) {
        console.log("No file or directory selected for capture data destination, returning.");
        launchProgressCountdown(0);
        cancelThis = true;
      } else {

        console.log("Capture to file selected ... setting up ...");

        if ( doFileCapture ) {
          await setupFileCapture(
            parseInt(commandAndType.chainedCmdDelayMs),
            captureSizeBytes
          ).then ( (res) => {
            if ( !res ) {
              console.log("setupFileCapture returned : " + res + ", so ... returning, ie not proceeding with the command processing");
              launchProgressCountdown(0);
            } else {
              controlPortSendData_SetupAndSendCommands(commandAndType);
            }
          }).catch ( (e) => {
            console.log("Error proceeding after setupFileCapture and doing the command processing and sending: " + e);
            launchProgressCountdown(0);
          });
        }

        if ( doFileCaptureCustomToDirectory ) {
          setupFileCaptureCustomBatches(    // was await - but now this returns a promise
            captureDataFileOutputDirectory,
            captureSizeNumberOfWaveformsPerFile
          )
          .then( (res) => {
            if ( !res ) {
              console.error("setup File Capture Custom Batches returned : " + res + ", so ... returning, ie not proceeding with the command processing");
              launchProgressCountdown(0);
            } else {
              console.log("about to call controlPortSendData_SetupAndSendCommands");
              var overrideTotalProgressTimeMs = captureDataFileOutputBatch.SingleFileCaptureDurationMs();
              controlPortSendData_SetupAndSendCommands(commandAndType, overrideTotalProgressTimeMs);
              // Not sure - perhaps this should be promised and chained:
              console.log("controlPortSendData: waveformsPerFile for batch output calculated to: " + captureDataFileOutputBatch.WaveformsPerFile());
            }
          })
          .catch( (e) => {
            console.error("Error proceeding after setup File Capture Custom Batches and doing the command processing and sending: " + e);
            launchProgressCountdown(0);
          });
        } // end: if doFileCaptureCustomToDirectory

      }
    }

  } else {  // if not port ...
    console.log ('sprenderer: error on controlPortSendData: port does not yet exist or has not been opened');
  }

}










var controlPortSendData_SetupAndSendCommands = function(commandAndType, overrideTotalProgressTimeMs) {

  // Now handle the command type and sending the control commands to the device

  var totTimeout = 0;

  switch ( commandAndType.type ) {

    case "hexCsvBytes":
      var cmd = commandAndType.value.replace(/\s/g,"").split(',');
      var cmdarr = [];
      cmd.forEach(function(c) {
        cmdarr.push(parseInt(c));
      });
      console.log("controlPortSendData_SetupAndSendCommands: " + cmdarr);
      cport.write(cmdarr, function (err) {
        if ( err ) {
          console.log('sprenderer: error on write within controlPortSendData_SetupAndSendCommands: ', err.message)
        }
      });
      break;

    case "hexCsvBytesChained":
      var delayBwCalls = parseInt(commandAndType.chainedCmdDelayMs);
      var responseTimeout = parseInt(commandAndType.chainedCmdTimeoutMs);
      var responseTermChar = commandAndType.chainedCmdCompleteChar;
      if ( delayBwCalls ) {
        var len = commandAndType.value.length;
        console.log("hexCsvBytesChained: " + len + " commands found ...");
        commandAndType.value.forEach ( function (catv, index) {
          var cmd = catv.replace(/\s/g,"").split(',');
          var cmdarr = [];
          cmd.forEach(function(c) {
            cmdarr.push(parseInt(c));
          });
          var s = setTimeout( function () {
            console.log("Firing command " + (index + 1) + " of " + len);
            console.log(cmdarr);
            cport.write(cmdarr, function (err) {
              if ( err ) {
                console.log('sprenderer: error on write within controlPortSendData_SetupAndSendCommands: ', err.message)
              }
            });
            // If this is the last command, clear the list somehow
            if ( (index + 1) === len ) {
              executingTimeoutFcns = [];
            }
          }, totTimeout, index, len, cmdarr);
          executingTimeoutFcns.push(s);
          // Could also do progress bar as percentage of steps remaining
          // or combination of that and time
          // Don't add a delay after the last call to the total
          if ( (index + 1) < len ) {
            totTimeout += delayBwCalls;
          }
          console.log("Total timeout: " + totTimeout);
        });
      } else
      if ( !delayBwCalls && ( responseTimeout && responseTermChar ) ) {
        // Is arguments.callee.name deprecated or not?
        console.log(arguments.callee.name + ": hexCsvBytesChained with sequenced cmds issued and termination of each stage based on response termination character or response timeout");
        // See above - parsers requires a new serialport
        //const parser = port.pipe(new Delimiter({ delimiter: '\n'}));
        //parser.on('data', console.log);
      }
      break;
      // End case: hexCsvBytesChained

    default:
      console.log('sprenderer: error on controlPortSendData_SetupAndSendCommands: type in command with type is not (yet) supported: ' + commandAndType.type);
  }

  // Again, could instead use percentage of completed steps instead
  let tto = overrideTotalProgressTimeMs ? overrideTotalProgressTimeMs : totTimeout;
  console.log(`controlPortSendData_SetupAndSendCommands: totalProgressCountdown to use: ${tto}`);
  launchProgressCountdown(tto);

} // End of: controlPortSendData_SetupAndSendCommands







setupFileCaptureCustomBatches = ( outputDirectory, numberOfWaveformsPerFile ) => {

  // Yes, functionally, at this writing,
  // this is called each time we "start" acquisition from the data capture focused UI/UX

  captureDataFileOutputBatch = null;

  captureDataFileOutputBatch = new CaptureDataFileOutput({
    directory: outputDirectory,
    numberOfWaveformsPerFile: numberOfWaveformsPerFile,
    numberOfSamplesPerWaveform : defaultHardwareWaveformLengthSamples,  // Same as below
    numberOfBytesPerSample: defaultHardwareWaveformBytesPerSample,       // From mainWindow (defined)
    waveformSampleFrequencyHz: defaultHardwareWaveformSampleFrequencyHz,   // Same as comment above
    structureIdInfoInputEle: YouFace.GetStructureIdInfoInput(),
    plugins : plugins                                                     // From mainWindow (defined)
  });

  return new Promise ((resolve, reject) => {

    captureDataFileOutputBatch.LoadCaptureOptions()
    .then( res => {
      captureDataFileOutputBatch.CheckOutputDirectory();
    })
    .then( res => {
      console.log("LoadCaptureOptions and CheckOutputDirectory OK - resolving to true");
      resolve(true);
    })
    .catch ( e => {
      console.error("setup File Capture Custom Batches error in chain: " + e);
      reject(false);
    });

  });

  //return everythingIsFine;
}







var fileCaptureTimeoutId = null;
var setupFileCapture = ( durationMs, maxFileSizeBytes ) => {

  // currentWriteStreamFilepath is global at present

  // https://stackoverflow.com/questions/43293921/cant-catch-exception-from-fs-createwritestream

  var everythingIsFine = true;

  currentMaxCaptureFileSizeBytes = maxFileSizeBytes;
  currentBytesCaptured = 0;

  return new Promise ((resolve, reject) => {

    // TODO - fix this up with var? with issues, etc.
    // Testing:
    resetReadableStream(8);

    writeStream = fs.createWriteStream(currentWriteStreamFilepath);
    writeStream.on('error', function(err) {
      console.log("createWriteStream for " + currentWriteStreamFilepath + " error: " + err);
      closeAndCleanupFileCapture();
      everythingIsFine = false;
      reject(everythingIsFine);
    })
    fileCaptureTimeoutId = setTimeout( function() {
      closeAndCleanupFileCapture();
    }, durationMs );
    resolve(everythingIsFine);

  });

}







var closeAndCleanupFileCapture = function() {

  launchProgressCountdown(0);

  // For basic standard file capture demo:
  if ( writeStream ) {
    writeStream.end();
    showControlPortOutput('Capture file closed.\r\n');
  }
  writeStream = null;
  currentWriteStreamFilepath = null;
  if ( fileCaptureTimeoutId ) {
    clearTimeout(fileCaptureTimeoutId);
  }
  fileCaptureTimeoutId = null;
  currentMaxCaptureFileSizeBytes = null;
  currentBytesCaptured = null;

  // HOOKALERT01
  captureDataFileOutputBatch.CleanUpFileFragments()
  .then( res => {
    // For custom user batch file capture
    captureDataFileOutputBatch = null;
  })
  
  // For custom user batch file capture
  //captureDataFileOutputBatch = null;


  // TODO -- what about including as a callback any sort of closing commands
  // to terminate streaming data from the hardware, etc.?

}












var progressTimeoutId;
var launchProgressCountdown = function( totMs ) {

  // Could also do the progress bar as percentage of items remaining
  // https://stackoverflow.com/questions/24530908/showing-a-time-countdown-progress-bar

  // vs the parent div class that is progress
  var pbar = $('#theBarItself');

  progressTimeoutId = progress(totMs/1000, totMs/1000, pbar);

}






var progress = function (timeleft, timetotal, element) {
  //console.log("progress: " + timeleft);
  var timeoutId;
  var progressBarWidth = Math.round((1.0 - (timeleft / timetotal)) * 100) + "%"; // timeleft * $element.width() / timetotal;
  //console.log("current: " + $(element).css("width"));
  //console.log("progress: " + progressBarWidth);
  //$(element).animate({ width: progressBarWidth }); //.html(timeleft + " seconds to go");
  $(element).css("width", progressBarWidth);
  if(timeleft > 0) {
      timeoutId = setTimeout(function() {
          progress(timeleft - 0.5, timetotal, element);
      }, 500);
  } else {
    //$(element).animate({width: "100%"}, 100);
    $(element).css("width", "100%");
    setTimeout ( function() {
      $(element).parent().css("background-color", "green");
    }, 200);
    setTimeout( function() {
      $(element).parent().animate({ backgroundColor: "#acece6"}, 2000);
    }, 500);
    setTimeout( function() {
      //$(element).animate({width: "0%"}, 1000);
      $(element).css("width", "0%");
    }, 1000);
    timeoutId = null;
  }
  progressTimeoutId = timeoutId
  return timeoutId;
};












//var cancelCustomControlButtonCommand = function() {
var cancelCustomControlButtonCommand = () => {

  //
  // cancel the ftdi-d2xx-wrap timeouts here or similar ???
  // Is it necessary? Nope. Was not done for the prior data port either
  // Assumption is that it is not presently important or part of work flow 
  // or even sufficiently valuable best practice yet. 
  // The data port close / open however has been updated and works.

  console.log ("cancelCustomControlButtonCommand. Executing timeout fcns are:");
  console.log(executingTimeoutFcns);

  var jsonForButtons = {}; //captureDataFileOutputBatch.ManagedStopNow();

  // HOOKALERT01 managedStop -- does this work? yes.
  //captureDataFileOutputBatch.ManagedStop();

  return new Promise ((resolve, reject) => {

    // If not using like captureDataFileOutputBatch then button implies 
    // in UX just clear the console window here so:
    if ( !captureDataFileOutputBatch ) {
      console.log("Since !captureDataFileOutputBatch, interpreting this button not as a ManagedStopNow but rather as a clear this UI text log output.");
      $('#cmdOutput').text('');
      resolve(true);
      return;
    }


    captureDataFileOutputBatch.ManagedStopNow()
    .then( jsonForButtons => {

      if ( jsonForButtons.stopNow == true ) {

        if ( executingTimeoutFcns.length > 0 ) {
          executingTimeoutFcns.forEach( function(etf, index) {
            clearTimeout(etf);
            console.log("Clearing timeout execution for #" + index);
          });
          if ( progressTimeoutId ) {
            clearTimeout(progressTimeoutId);
            progressTimeoutId = null;
            launchProgressCountdown(0);
          }
          showControlPortOutput("Cancel done.\r\n");
        } else {
          showControlPortOutput("Nothing to cancel.\r\n");
        }
        closeAndCleanupFileCapture(); // also calls the batch capture object to delete any fragments

      }
      return jsonForButtons;

    })
    .then( jsonForButtons => {

      console.log( JSON.stringify(jsonForButtons) );
      resolve(jsonForButtons);

    })
    .catch ( e =>  {

      reject(`error ${e}`);

    });

  }); // End of:  Promise

  
  //console.log( JSON.stringify(jsonForButtons) );

  //return jsonForButtons;

} // End of: cancelCustomControlButtonCommand()









var controlPortSendDataFromTextInput = function ( button, commandAndType) {

  // At this draft, button may be a button control or a p with range child

  //alert('got it');
  //return;

  if ( cport ) {
    var cmdarr = [];
    // Warning: there needs of course to be some kind of limits and sanity
    // checking structure -- length of commands, etc.
    // This could be a separate structure that is required with an imported
    // command set such that validation occurs within this ruleset prior to
    // allowing execution
    switch ( commandAndType.type ) {

      case "hexCsvBytes":
        var cmd = commandAndType.value.replace(/\s/g,"").split(',');
        var cmdarr = [];
        cmd.forEach(function(c) {
          cmdarr.push(parseInt(c));
        });
        var repl = commandAndType.positionToReplaceWithTextInputBaseZero;
        if ( isNaN(repl) ) {
          // TODO : throw
          alert ("controlPortSendDataFromTextInput: commandAndType.positionToReplaceWithTextInputBaseZero failed parseInt!");
          return;
        }
        // The parent most div id can be found based on the button id
        // and thus only text input field can thus be found
        // or we are handed a p object with child range ...
        var ti;
        var val;

        ti = $(button).find('input[id^="range"]');

        if ( ti.length > 0 ) {
          val = parseInt(ti.val());
        } else {
          var tiId = $(button).prop("id").replace("button","div");
          ti = $("#"+tiId).find("input[type='text']");
          val = parseInt( $(ti).val() );
        }
        if ( isNaN(val) ) {
          // TODO - throw
          alert ("controlPortSendDataFromTextInput: textInput:\r\n" + $(ti).val() + "\r\nain't working as parseInt -- Looks like it's not a number that can be parsed to in integer.");
          // TODO - how to actively reset this so the cleared programmatic value actually becomes visible?
          // Something simple I'm missing here ...
          //$(ti).attr('value', '1').trigger("change").trigger("click"); // Still doesn't show in DOM/UI yet
          //M.updateTextFields(); // Still not
          //$(ti).removeAttr('value'); // Still not
          //alert($(ti).val());
          return;
        }
        cmdarr[repl] = val; // replace the command position with the text input value
        // TODO range validation?
        console.log("controlPortSendDataFromTextInput: " + cmdarr);
        cport.write(cmdarr, function (err) {
          if ( err ) {
            console.log('sprenderer: error on write within controlPortSendDataFromTextInput: ', err.message)
          }
        });
        break;

      case "hexCsvBytesChained":
        alert("hexCsvBytesChained for controlPortSendDataFromTextInput not yet implemented! returning ...");
        return;

        var delayBwCalls = parseInt(commandAndType.chainedCmdDelayMs);
        var responseTimeout = parseInt(commandAndType.chainedCmdTimeoutMs);
        var responseTermChar = commandAndType.chainedCmdCompleteChar;
        if ( delayBwCalls ) {
          // Use
          var totTimeout = 0;
          var len = commandAndType.value.length;
          console.log("hexCsvBytesChained: " + len + " commands found ...");
          commandAndType.value.forEach ( function (catv, index) {
            var cmd = catv.replace(/\s/g,"").split(',');
            var cmdarr = [];
            cmd.forEach(function(c) {
              cmdarr.push(parseInt(c));
            });
            setTimeout( function () {
              console.log("Firing command " + (index + 1) + " of " + len);
              console.log(cmdarr);
              cport.write(cmdarr, function (err) {
                if ( err ) {
                  console.log('sprenderer: error on write within controlPortSendDataFromTextInput: ', err.message)
                }
              });
            }, totTimeout, index, len, cmdarr);
            totTimeout += delayBwCalls;
            console.log("Total timeout: " + totTimeout);
          });
        } else
        if ( !delayBwCalls && ( responseTimeout && responseTermChar ) ) {
          // Is arguments.callee.name deprecated or not?
          console.log(arguments.callee.name + ": hexCsvBytesChained with sequenced cmds issued and termination of each stage based on response termination character or response timeout");
          // See above - parsers requires a new serialport
          //const parser = port.pipe(new Delimiter({ delimiter: '\n'}));
          //parser.on('data', console.log);
        }
        break;
        // End case: hexCsvBytesChained

      default:
        console.log('sprenderer: error on controlPortSendDataFromTextInput: type in command with type is not (yet) supported: ' + commandAndType.type);
    }



  } else {  // if not port ...
    console.log ('sprenderer: error on controlPortSendDataFromTextInput: port does not yet exist or has not been opened');
  }

} // End of: controlPortSendDataFromTextInput









var getHardwareData = function() {

  return hw;

} // End of: getHardwareData





module.exports = {
  serialOpenByName: serialOpenByName,
  serialClose: serialClose,
  controlPortClose: controlPortClose,
  controlPortOpen: controlPortOpen,
  controlPortSendStuff: controlPortSendStuff,
  serialTestWrite: serialTestWrite,
  serialSendData: serialSendData,
  controlPortSendData: controlPortSendData,
  controlPortSendDataFromTextInput: controlPortSendDataFromTextInput,
  serialCheckbox: serialCheckbox,
  beginSerialComms: beginSerialComms,
  btnDataPortClick: btnDataPortClick,
  btnControlPortClick: btnControlPortClick,
  cancelCustomControlButtonCommand: cancelCustomControlButtonCommand,
  vcpFind: vcpFind,
  ftdiFind: ftdiFind,
  setupModalHardwareSelect: setupModalHardwareSelect,
  setHardwareByFullname : setHardwareByFullname,
  getHardwareData : getHardwareData,
};
