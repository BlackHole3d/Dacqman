// interface.js
// At this current first draft, this file
// ASSUMES called from this specific mainWindow.html in this project
// TODO move entire construction of the section here? Or to template?
// TODO create object and pass parent div?

const { controlPortClose } = require('./sprenderer.js');


const captDataEmitter = require('./capture-data.js').CaptDataEmitter; // For subscribing to events


const electron = require('electron');
const {ipcRenderer } = electron;



// Consts
// From prefs implementation
const useRegular = 'regular';
const useDataCaptureFocused = 'dataCaptureFocused';
const uiDataCaptureFocusedHtmlSnippetFilepath = "./userInterfaceDataCaptureFocused.html";
const uiInterfaceRefinementSimple = 'simple';



// Variables here are NOT unique to an object instance





// ES6
class UserInterface {

  constructor ({

    // default constructor parameters/properties
    uiRegularDivs = ['#singleWaveformChartAccordion', '#multiWaveformChartAccordion'],
    uiDataCaptureFocusedParentDiv = '#capture_ui'

  } = {}) {

    // Any variables (properties) here, if attached to the "this", ie this object
    // are publicly accessible but unique to this instance
    // And are separated only semantically by "_" as intended to used
    // publicly or privately
    this._uiRegularDivs = uiRegularDivs;
    this._uiDataCaptureFocusedParentDiv = $(uiDataCaptureFocusedParentDiv);

    // Not constructed:
    this._captureDataFileOutputDirectory = null;
    this._buttonsJson = null;
    this._managedStopType = null;
    this._currentUi = "";
    this._currentUiRefinement = "";

    // TEMP? 2023 Q1
    // Attempting to store the number of channels for a set chans event:
    //this._numChannels = null;


    captDataEmitter.on('captureDataNewFile', (data) => {
      let e = $('#uiProgressTextBar');
      let eHolder = $('#capture_ui_current_filename');
      $('#filesWrittenBadge').text(data.fn);
      e.text(data.fp); // filepath here
      eHolder.addClass('pulse-div');
      this.updateProgressPercentage(0);
      setTimeout(
        function () {
          $('#capture_ui_current_filename').removeClass('pulse-div');
        }, 1500
      );
    });

    captDataEmitter.on('captureDataProgress', (data) => {
      //console.log("userInterface.js: capt Data Emitter: data: " + data);
      this.updateProgressPercentage(data);
    }); // end of capt Data Emitter.on capture Data Progress

    captDataEmitter.once('captureDataNumberOfChannelsSet', (dataIsNumChans) => {
      this._numChannels = dataIsNumChans;
      UISetupMultipaneCharts(dataIsNumChans);
    });

    // HOOKALERT01 
    captDataEmitter.on('captureDataManagedStopLastFileComplete', (data) => {
      $('#btnCaptureStop').click();
    });

    // Would not fire if the popout were clicked prior to running data because this UI
    // instance doesn't exist yet 
    // Yes this module still receives the mainWindow.webContents sends ...
    // HOOKALERT04
    // ipcRenderer.on('multiWfsWindowCreated', (data) => {
    //   console.log("userInterface: received multiWfsWindowCreated event via ipcRenderer");
    //   console.log(`userInterface: current number of channels in the UI instance: ${this._numChannels}`);
    //   if ( this._numChannels ) {
    //     UISetupMultipaneCharts(this._numChannels);
    //   } else {
    //     console.log("this._numChannels is null ... did not call UISetupMultipaneCharts");
    //   }
    // });
    //
    // ipcRenderer.on('multiWfsWindow:created', (data) => {
    //   console.log("received multiWfsWindowCreated event via ipcRenderer");
      
    // });


  } // end of constructor





  get captureDataFileOutputDirectory() {
    return this._captureDataFileOutputDirectory;
  }

  get buttonsJson () {
    return this._buttonsJson;
  }

  set captureDataFileOutputDirectory (dir) {
    this._captureDataFileOutputDirectory = dir;
  }

  set buttonsJson (js) {
    this._buttonsJson = js;
  }






  updateProgressPercentage ( percent ) {

    // We limit to 99% because the UI displays best this way
    // At 100% it extends past the end -- we could fix in custom styling
    // or maybe in js somewhere - it's a materializecss thing I think so far
    // In this particular implementation anyway
    // Update: with the updated 99% in the holder in custom.css, this is no
    // longer needed
    //percent = percent > 99.0 ? 99.0 : percent;
    $('#uiProgressTextBar').css("width", parseInt(percent) + "%");
    //console.log("update progress percentage: percent: " + percent);
    if ( percent > 99 ) {
      $('#capture_ui_current_filename').addClass("green");
      $('#uiProgressHolder').addClass("green lighten-1");
      setTimeout( function() {
        $('#capture_ui_current_filename').removeClass("green");
        $('#uiProgressHolder').removeClass("green lighten-1");
      }, 800);
    }

  } // end of update Progress Percentage








  SwitchInterface ( uiInterface, uiInterfaceRefinement, shouldReload) {

    switch ( uiInterface ) {
      case useRegular:
        this._uiDataCaptureFocusedParentDiv.addClass("hide");
        this._uiRegularDivs.map(function(d){$(d).collapsible("open")});
        this._uiDataCaptureFocusedParentDiv.empty();
        this._currentUi = useRegular;
        this._currentUiRefinement = uiInterfaceRefinement;
        break;
      case useDataCaptureFocused:
        this._currentUi = useDataCaptureFocused;
        this._currentUiRefinement = uiInterfaceRefinement;
        if ( this._uiDataCaptureFocusedParentDiv.children("div").length < 1 ) {
            var json = this.buttonsJson;
            // 2nd param is callback function on completion
            this._uiDataCaptureFocusedParentDiv.load(uiDataCaptureFocusedHtmlSnippetFilepath, this.afterHtmlLoadedCallback(json));
        }
        this._uiDataCaptureFocusedParentDiv.removeClass("hide");
        this._uiRegularDivs.map(function(d){$(d).collapsible("close")});

        // HOOKALERT02
        // Breaking protocol for just direct selection and manipulation in this mode
        // if ( uiInterfaceRefinement && uiInterfaceRefinement == uiInterfaceRefinementSimple ) {
        //   $('#activeSerialPortStuff').addClass("hide");
        //   $('#singleWaveformChartAccordion').addClass("hide");
        //   var e1 = $('#divCustomControlVariableInputs');
        //   var newParent = $('#activeControlPort');
        //   newParent.find(".card-content").addClass("hide");
        //   e1.detach().appendTo(newParent);
        //   e1.find(".onlyAppliesToSingleChannelDaq").addClass("hide");
        //   e1.find(".range-field").removeClass("s6").addClass("s4");
        // }
        this.RefreshFormatRefinement();
        break;
      case useNewUI:
          console.log("Switching to New User Interface");

          // Add your UI-switching code here...
          // You will likely need to hide/show different elements,
          // load different content, etc. For example:
          // this._uiNewUiDivs.map(function(d){$(d).collapsible("open")});
          // this._uiDataCaptureFocusedParentDiv.addClass("hide");
          // this._uiRegularDivs.map(function(d){$(d).collapsible("close")});

          this._currentUi = useNewUI;
          this._currentUiRefinement = uiInterfaceRefinement;
        break;

      default:
        console.log(`uiInterface case: ${uiInterface} not handled.`);
    } // end of switch
    if (shouldReload) {
      location.reload();
    }
  } // End of: SwitchInterface






  RefreshFormatRefinement () {
    // HOOKALERT02
    // Breaking protocol for just direct selection and manipulation in this mode
    if ( this._currentUi == useDataCaptureFocused 
      && this._currentUiRefinement 
      && this._currentUiRefinement == uiInterfaceRefinementSimple ) {
      $('#activeSerialPortStuff').addClass("hide");
      $('#singleWaveformChartAccordion').addClass("hide");
      $('#divCardConsoleLike').addClass("hide");
      var e1 = $('#divCustomControlVariableInputs');
      var newParent = $('#activeControlPort');
      newParent.find(".card-content").addClass("hide");
      e1.detach().appendTo(newParent);
      e1.find(".onlyAppliesToSingleChannelDaq").addClass("hide");
      e1.find(".range-field").removeClass("s6").addClass("s4"); // TODO works only if there are 3 items remaining
      var visibleInputs = e1.find('div.row').find('div[id^=container]:not(.hide)');
      $('#divTextInputRowZero').remove();
      var newRow = $(document.createElement('div'));
      newRow
      .addClass('row')
      .prop('id', 'divTextInputRowZero');
      e1.append(newRow);
      //e1.find('.right-align.col.s2').removeClass('s2').addClass('s6');
      //e1.find('.left-align.col.s1').removeClass('s1').addClass('s4');
      visibleInputs.detach().appendTo(newRow);
    }
  } // End of: RefreshFormatRefinement






  afterHtmlLoadedCallback (addlParam) {
    // We stack in the extra param value here and return the expected callback
    // signature because otherwise the addlParam (eg json) gets lost due to lost
    // this. context

    // this. works here, but you won't be able to access the added html here
    //this.addOnClickFunctionsToDataCaptureFocused();
    return function ( htmlResult, status, xhr ) {
      // this. doesn't work here, and these functions use arrow notation outside
      // of the class
      addButtonLogicFromJson(addlParam);
      addOnClickFunctionsToDataCaptureFocused();
    }
  } // End of: afterHtmlLoadedCallback








  Load ( uiInterface, uiInterfaceRefinement, buttonsJson ) {

    this.buttonsJson = buttonsJson;
    this.SwitchInterface(uiInterface, uiInterfaceRefinement);

  } // End of: Load









} // End of : class UserInterface





//
// Add functions that access the unique, semantically-only-private-by-intention
// but not in reality, properties
//



// This is here and exported as well because
// we need it in cases where the reference to this is otherwise lost
// when for example this function is called in the added click event
// that calls Directory Select Click
// Arrow function auto-creates reference to "this"
EnableCaptureButtons = () => {

  var d = $(document);

  [
    '#btnFilesWritten',
    '#btnWarnings',
    '#btnErrors'

    , '#btnCaptureStart'
    //, '#btnCaptureStop' // Only enable if Start has been clicked, and etc for such UX
  ].map( function(i) {
    d.find( $(i) ).removeClass('disabled');
  });

  $('#filesWrittenBadge').removeClass('grey').addClass('blue lighten-2');

} // End of: enableCaptureButtons







DirectorySelectClick = (event) => {

  console.log("DirectorySelectClick");

  // Electron 4.2.12 => 7.3.3 dialog.showOpenDialog is now Promise 
  // vs Sync option behaves like the old
  var captureDataFileOutputDirectory = dialog.showOpenDialogSync( {
    title : 'Select and/or create your captured data directory ...',
    buttonLabel: 'Start Capture to this Directory',
    properties: [ 'openDirectory', 'createDirectory']
  });

  if ( captureDataFileOutputDirectory ) {
    // This below actually does nothing, the way that this function is defined
    // and used -- because it loses scope of the originating this
    this.captureDataFileOutputDirectory = captureDataFileOutputDirectory;
    $('#labelForSelectOutputDirectory').empty();  // clear the label
    $('#selectOutputDirectory').val(this.captureDataFileOutputDirectory);

    // When the click event is added, at the moment, as coded,
    // we lose reference to this, so we don't call or define or use
    // this . enable Capture Buttons
    EnableCaptureButtons();
    $('#capture_ui_directory_select').removeClass("teal lighten-5 pulse-div");

    // Now show the filename info area (which includes its progress bar)
    $('#capture_ui_current_filename').removeClass("hide");
  }

} // End of: DirectorySelectClick








addButtonLogicFromJson = ( jsonButtons ) => {

  jsonButtons.map( function(jb) {
    var b = $(document).find("#" + jb.mapToButtonId);
    if ( b ) {
      console.log(`Adding logic from json button to id ${jb.mapToButtonId} for button ${b.attr("id")}`);
      b
        .prop('title', jb.description)
        .click(function() {
          // if this is a stop/cancel button: call the cancel functionality
          // within the sprendered.js module/file
          // Also, we should call this first - because the called function(s)
          // will cancel pending progress ids
          // Whereas the control port send data in this case will also
          // create a progress update to 0 which would clear out the ref
          // to pending progress timeout ids and thus the ability to clear
          // timeouts by id gets nulled out
          if ( jb.mapToButtonId === 'btnCaptureStop' ) {
            //
            // HOOKALERT01 -- somewhere here or within either next two commands is where we check for customCaptureOptionsJson.additionalFileInfo.managedStop.stopType 
            //
            // Below: defined in mainWindow.js as an sprend.function; function implemented in sprenderer.js - and now talks to the capture-data batch file output object to manageStop if necessary
            cancelCustomControlButtonCommand()
            .then( whatToDoNowJson => {
              console.log(JSON.stringify(whatToDoNowJson));
              //if ( whatToDoNowJson.stopNow == false ) {
                $('#btnCaptureStop').text(whatToDoNowJson.stopButtonText);
                $('#btnCaptureStop').addClass(whatToDoNowJson.stopButtonAddClass);
                $('#btnCaptureStop').removeClass(whatToDoNowJson.stopButtonRemoveClass);
                $('#btnCaptureStart').removeClass(whatToDoNowJson.startButtonRemoveClass);
                $('#structureIdInfo').prop('disabled', whatToDoNowJson.structureIdInfoDisabled);
              //} 
              if ( whatToDoNowJson.stopNow == true ) {

                endOfCaptureBatch();                // defined locally in this file, UI update only

                // Then send the command
                var d = $('#capture_ui_directory_select').find("input").val();

                // the command is implemented in sprenderer
                controlPortSendData(jb.command, jb.returnDataTo, jb, d );
              }
              return whatToDoNowJson;
            });
            // .then( whatToDoNowJson => {
            //   // Ok just plain old stop now
            //   endOfCaptureBatch();                // defined locally in this file, UI update only
            //   $('#btnCaptureStop').addClass("disabled");
            //   $('#btnCaptureStart').removeClass("disabled");
            //   $('#structureIdInfo').prop('disabled', false);
            // });
          }

          if ( jb.mapToButtonId === 'btnCaptureStart' ) {
            $('#btnCaptureStop').removeClass("disabled");
            $('#btnCaptureStart').addClass("disabled");
            $('#structureIdInfo').prop('disabled', true);

            // Then send the command
            var d = $('#capture_ui_directory_select').find("input").val();

            // the command is implemented in sprenderer
            controlPortSendData(jb.command, jb.returnDataTo, jb, d );
          }

        });
    }
  });

} // End of: addButtonLogicFromJson








endOfCaptureBatch = () => {

  // Not available at this. :
  //updateProgressPercentage(0);

  $('#uiProgressTextBar').css("width", "0%");

} // End of: endOfCaptureBatch








addOnClickFunctionsToDataCaptureFocused = () => {

  $('#capture_ui_directory_select.row').click( function(event) {
    DirectorySelectClick(event);
  });

} // End of: addOnClickFunctionsToDataCaptureFocused







UserInterface.Ready = () => {

  // TODO check current UI selection - move above check about
  // the doc being filled with this content
  // and then conditional adjust this ... otherwise of course
  // an error will be gen'd as this div won't exist
  $('#capture_ui_directory_select').addClass("teal lighten-5 pulse-div");
  //$('#capture_ui_current_filename div:last-child').text("No output file created yet ... this will show after STARTing acquisition ...");
  $('#uiProgressTextBar').text("No output file created yet ... this will show after STARTing acquisition ...");

  $('#structureIdInfo').prop('disabled', false);

}





UISetupMultipaneCharts = ( nChans ) => {

  //var nChans = GetNumberOfChannels() || 4; // Common usage to date is 4 as a reasonable default
  var classes = "col s12 m6 l4"; // This is/was the default for 8 channels
  if ( nChans == 4 ) {
    classes = "col s12 m6"; // here since no l specified it will max at 6-cols = 2 per row
  }
  console.log(`userInterface: setting up multipane charts for ${nChans} channels`);
  SetupMultipaneCharts(nChans, classes); // declared in the mainWindow.html script, thus this module must be loaded from within mainWindow.html

  // TODO cleanup the implementation of this function overall, esp.
  // in mainWindow.html
  // It is called again here for now because it is called in pairs switching
  // from multiChart to default of chart -- one cancels the previous and the next
  // starts the new mode -- without this, we are left in cancel mode so adding
  // this here starts the RenderCharts again
  mainWindowUpdateChartData(null);
}





GetNumberOfChannels = () => {
  return MainWindowGetNumberOfChannels(); // also declared within mainWindow.html script, thus this module must be loaded from within mainWindow.html
}






UserInterface.GetStructureIdInfoInput = () => {

  ele = null;

  if ( $('#structureIdInfo') ) {
    if ( $('#structureIdInfo').is(":visible") ) {
      ele = $('#structureIdInfo');
    }
  }

  return ele;


}








module.exports = {

  // Constants

  // Functions to be accessed from other modules
  EnableCaptureButtons,
  DirectorySelectClick,

  // Classes
  UserInterface
};
