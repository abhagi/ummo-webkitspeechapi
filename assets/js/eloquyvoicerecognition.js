/* For Google Web Speech engine */
var final_transcript = '';
var recognizing = false;
var ignore_onend;
var start_timestamp;
var recognition;

/* Constants */
var fillerwords = ['like', 'so', 'i mean', 'you know', 'literally', 'actually', 'sort of', 'thing', 'stuff'];

var fillerwordsUsedSoFar = {};

/* Timer related vars */
var timerSecondsElapsed = 0;
var timerIntervalId;
var timerInterval = 1000; // milliseconds

var gaugeTimerIntervalId;
var gagueTimerInterval = 100; // milliseconds

/* Volume and Pitch meter related vars */
var audioContext;
var meter;
var mediaStreamSource = null;
var VOLUME_MULTIPLICATION_FACTOR = 2500;

var isPlaying = false;
var sourceNode = null;
var analyser = null;
var theBuffer = null;

/* Global components */
var volumeGauge, pitchGauge;

// Initial setup stuff to do when page loads
$(document).ready(function () {
    $("#clockelement").html('off');
    $("#clockelement").show();

    $("#pitchGaugeDiv").hide();
    $("#volumeGaugeDiv").hide();
    $("#centralcolwithtoggle").addClass("col-lg-12");

    /** SET UP VOLUME AND PITCH METER BY READING AND PROCESSING MIC RAW DATA **/

    // monkeypatch Web Audio
    window.AudioContext = window.AudioContext || window.webkitAudioContext;

    // grab an audio context
    audioContext = new AudioContext();

    // Attempt to get audio input
    try {
        // monkeypatch getUserMedia
        navigator.getUserMedia =
            navigator.getUserMedia ||
            navigator.webkitGetUserMedia ||
            navigator.mozGetUserMedia;

        // ask for an audio input
        navigator.getUserMedia({
            "audio": {
                "mandatory": {
                    "googEchoCancellation": "false",
                    "googAutoGainControl": "false",
                    "googNoiseSuppression": "false",
                    "googHighpassFilter": "false"
                },
                "optional": []
            },
        }, gotStream, didntGetStream);
    } catch (e) {
        alert('getUserMedia threw exception :' + e);
    }

    /** SET UP THE TWO GAUGE CHARTS USING c3.js library, KEEP THEM HIDDEN **/
    volumeGauge = c3.generate({
        bindto: '#volumeGauge',
        data: {
            columns: [
            ['data', 0.0]
        ],
            type: 'gauge',
            onclick: function (d, i) { /*console.log("onclick", d, i);*/ },
            onmouseover: function (d, i) { /*console.log("onmouseover", d, i);*/ },
            onmouseout: function (d, i) { /*console.log("onmouseout", d, i);*/ }
        },
        gauge: {
            label: {
                format: function (value, ratio) {
                    return value;
                },
                show: false // to turn off the min/max labels.
            },
            min: 10, // 0 is default, //can handle negative min e.g. vacuum / voltage / current flow / rate of change
            max: 100 // 100 is default
            //    units: ' %',
            //    width: 39 // for adjusting arc thickness
        },
        color: {
            //pattern: ['#FF6F5F', '#FF6F37', '#8ce196', '#FFFF8F' ], // the three color levels for the percentage values.
            pattern: ['#FF6F5F', '#8ce196'],
            threshold: {
                //            unit: 'value', // percentage is default
                //            max: 200, // 100 is default
                values: [30, 50]
            }
        },
        size: {
            height: 180
        },
        tooltip: {
            show: false
        }
    });

    pitchGauge = c3.generate({
        bindto: '#pitchGauge',
        data: {
            columns: [
            ['data', 0.0]
        ],
            type: 'gauge',
            onclick: function (d, i) { /*console.log("onclick", d, i);*/ },
            onmouseover: function (d, i) { /*console.log("onmouseover", d, i);*/ },
            onmouseout: function (d, i) { /*console.log("onmouseout", d, i);*/ }
        },
        gauge: {
            label: {
                format: function (value, ratio) {
                    return value + ' Hz';
                },
                show: false // to turn off the min/max labels.
            },
            min: 300, // 0 is default, //can handle negative min e.g. vacuum / voltage / current flow / rate of change
            max: 2000, // 100 is default
            units: ' Hz',
            //    width: 39 // for adjusting arc thickness
        },
        color: {
            //pattern: ['#FF6F5F', '#FF6F37', '#8ce196', '#FFFF8F' ], // the three color levels for the percentage values.
            pattern: ['#8ce196'],
            threshold: {
                //            unit: 'value', // percentage is default
                //            max: 200, // 100 is default
                values: [100]
            }
        },
        size: {
            height: 180
        },
        tooltip: {
            show: false
        }
    });
});
/** END BODY on-ready jquery HANDLER **/


/**** VOLUME AND PITCH DETECTION FUNCTIONS ****/
function didntGetStream() {
    console.log('Mic audio stream generation failed.');
}

function gotStream(stream) {
    // Create an AudioNode from the stream.
    mediaStreamSource = audioContext.createMediaStreamSource(stream);

    // Create a new volume meter and connect it.
    meter = createAudioMeter(audioContext);


    // Create a new pitch meter and connect to it
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

}

var latestVolume, latestPitch, latestTranscriptWithoutHtml, interim_transcript;

function updatePitchAndVol() {
    analyser.getFloatTimeDomainData(buf);
    var ac = autoCorrelate(buf, audioContext.sampleRate);

    if (ac == -1) {
        latestPitch = -1;
        //$("#pitch").html('-- Hz');
        pitchGauge.load({
            columns: [['data', 0]]
        });
    } else {
        pitch = ac;
        // store latest pitch
        latestPitch = Math.round(pitch);
        //$("#pitch").html(latestPitch + ' Hz');
        pitchGauge.load({
            columns: [['data', latestPitch]]
        });
    }

    // store latest volume
    latestVolume = Math.round(meter.volume * VOLUME_MULTIPLICATION_FACTOR);
    //$("#vol").html(''+latestVolume);
    volumeGauge.load({
        columns: [['data', latestVolume]]
    });
}

/*** Word count calculator ***/
//l.sauer 2011, public domain
//returns a hash table with the word as index and frequency as value; good for svg / canvas -plotting or other experiments
//[:punct:]	Punctuation symbols . , " ' ? ! ; : # $ % & ( ) * + - / < > = @ [ ] \ ^ _ { } | ~
function getWordHistogramFor(text) {
    var hist = {};
    var words = text.split(/[\s*\.*\,\;\+?\#\|:\-\/\\\[\]\(\)\{\}$%&0-9*]/);

    for (var i in words)
        if (words[i].length > 1)
            hist[words[i]] ? hist[words[i]] += 1 : hist[words[i]] = 1;

    return hist;
};


/**** TIMER FUNCTIONS *****/
function startAndShowTimer() {
    timerSecondsElapsed = 0;
    timerIntervalId = setInterval(function () {
        timerSecondsElapsed += 1;
        updateSecondsAndMinsElapsed();
        updatePitchAndVol();
    }, timerInterval);
    $("#clockelement").html('00:00');
    $("#clockelement").removeClass('inactive');
    $("#clockelement").addClass('active');
    $("#clockelement").show();
}

function endTimer() {
    clearInterval(timerIntervalId);
    $("#clockelement").removeClass('active');
    $("#clockelement").addClass('inactive');
    $("#clockelement").html('off');
    //$("#clockelement").hide();
}

function updateSecondsAndMinsElapsed() {
    var str = '';

    if (timerSecondsElapsed / 60 < 10)
        str = '0' + Math.floor(timerSecondsElapsed / 60) + ':';
    else
        str = Math.floor(timerSecondsElapsed / 60) + ':';

    if (timerSecondsElapsed % 60 < 10)
        str += ('0' + Math.floor(timerSecondsElapsed % 60));
    else
        str += ('' + Math.floor(timerSecondsElapsed % 60));

    $("#clockelement").html(str);
}

function startRecognitionAndAnalysis() {
    // start listening for audio volume and analyzing frequency data
    mediaStreamSource.connect(meter);
    mediaStreamSource.connect(analyser);

    recognition = new webkitSpeechRecognition();
    var final_transcript = '';
    interim_transcript = '';
    
    // reset the final translation from lasttime
    latestTranscriptWithoutHtml = '';
    fillerwordsUsedSoFar = {};

    recognition.continuous = true;
    recognition.interimResults = true;

    ignore_onend = false;
    

    //start the gauge updating with volume and pitch
    gaugeTimerIntervalId = setInterval(function () {
        if (recognizing)
            updatePitchAndVol();
    }, gagueTimerInterval);

    //start the timer
    startAndShowTimer();

    start_timestamp = event.timeStamp;
    recognition.start();

    console.log("starting recognition");

    //update layout
    $("#centralcolwithtoggle").removeClass("col-lg-12");
    $("#centralcolwithtoggle").addClass("col-md-6");
    $("#pitchGaugeDiv").show();
    $("#volumeGaugeDiv").show();

    recognition.onstart = function () {
        console.log("recognition onstart");
        recognizing = true;
    };
    recognition.onerror = function (event) {
        if (event.error == 'no-speech') {
            ignore_onend = true;
        }
        if (event.error == 'audio-capture') {
            ignore_onend = true;
        }
        if (event.error == 'not-allowed') {
            ignore_onend = true;
        }
    };
    recognition.onend = function () {
        recognizing = false;
        if (ignore_onend) {
            return;
        }
        if (!final_transcript) {
            return;
        }
    };

    recognition.onresult = function (event) {
        console.log("result");
        interim_transcript = '';
        var bool_isResultFinal = false;
        var htmlstring = '';

        for (var i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                final_transcript += highlightfillerwords(event.results[i][0].transcript);
                latestTranscriptWithoutHtml += event.results[i][0].transcript;
                bool_isResultFinal = true;
            } else {
                interim_transcript += event.results[i][0].transcript;
            }
        }

        if (bool_isResultFinal) {
            console.log("FINAL: " + final_transcript);
            //latestTranscriptWithoutHtml = final_transcript;
            console.log("FINAL transcript without html: " + latestTranscriptWithoutHtml);
            //$("#convertedtext").removeClass( "interim-result" );
            //$("#convertedtext").addClass( "final-result" );
            //convertedtextbox.innerHTML = linebreak(final_transcript);
        } else {
            //convertedtextbox.innerHTML = linebreak(interim_transcript);
            console.log("INTERIM: " + interim_transcript);
        }

        final_transcript = capitalize(final_transcript);
        final_span.innerHTML = linebreak(final_transcript);
        interim_span.innerHTML = linebreak(interim_transcript);
        
        /*if (final_transcript == '')
            latestTranscriptWithoutHtml = interim_transcript;
        */

    };
}

function isAFillerWord(word) {
    for (var i = 0; i < fillerwords.length; i++) {
        if (word == fillerwords[i]) {
            return true;
        }
    }
}

function highlightfillerwords(original) {
    var updatedstring = original;

    var index_tracker = 0;
    var start_index = 0;
    var end_index = 0;

    var i, j;

    var OPEN_TAG = "<span class='highlight'>";
    var CLOSE_TAG = "</span>";

    // check for filler words and highlight them
    for (i = 0; i < fillerwords.length; i++) {
        index_tracker = 0;

        // find all instances of fillerword[i] and insert <span> before and after each one
        while ((start_index = updatedstring.toLowerCase().indexOf(fillerwords[i].toLowerCase(), index_tracker)) >= 0) {
            end_index = start_index + fillerwords[i].length;

            // add this filler phrase to our histogram of filler phrases so far
            if (!fillerwordsUsedSoFar[fillerwords[i]]) {
                fillerwordsUsedSoFar[fillerwords[i]] = 1;
            } else {
                fillerwordsUsedSoFar[fillerwords[i]] = fillerwordsUsedSoFar[fillerwords[i]] + 1;
            }

            updatedstring = updatedstring.slice(0, start_index) + OPEN_TAG + updatedstring.slice(start_index, end_index) + CLOSE_TAG + updatedstring.slice(end_index);

            index_tracker = start_index + OPEN_TAG.length + CLOSE_TAG.length;
        }
    }

    console.log("With span tags added: " + updatedstring);
    return updatedstring;

}

function stopRecognitionAndAnalysis() {
    recognition.stop();
    // stop listening for audio volume and analyzing frequency data
    mediaStreamSource.disconnect(meter);
    mediaStreamSource.disconnect(analyser);

    //end the clock / timer
    endTimer();

    //end gauge update timer
    clearInterval(gaugeTimerIntervalId);

    //hide the DOM elements and make the DOM changes
    $("#pitchGaugeDiv").hide();
    $("#volumeGaugeDiv").hide();
    $("#centralcolwithtoggle").addClass("col-lg-12");

    if (latestTranscriptWithoutHtml == ''){
        latestTranscriptWithoutHtml = interim_transcript;    
    }
    
    console.log("showing histogram: " + latestTranscriptWithoutHtml);
    var hist = getWordHistogramFor(latestTranscriptWithoutHtml);
    console.log(hist);

    var AllWords_sortable = [];
    for (var word in hist) {
        AllWords_sortable.push([word, hist[word]]);

        /*
        if ($.inArray(word, fillerwords) >= 0)
            FillerWords_sortable.push([word, hist[word]]);
        */
    }

    // sort the AllWords array
    AllWords_sortable.sort(function (a, b) {
        return b[1] - a[1]
    });

    console.log(AllWords_sortable);

    var AllWordsHist_forChart = [];
    for (var i = 0; i < AllWords_sortable.length; i++) {
        AllWordsHist_forChart.push({
            y: AllWords_sortable[i][1],
            label: "" + AllWords_sortable[i][1],
            indexLabel: AllWords_sortable[i][0]
        });

        if (i >= 9) break; // don't keep track of words after the first 10-most used
    }

    AllWordsHist_forChart.reverse();

    $("#allWordGraph").CanvasJSChart({ //Pass chart options
        title: {
            text: "Your top 10 words",
            fontFamily: 'Oswald',
            fontColor: "#555555",
            fontWeight: 300,
            fontSize: 28

        },
        animationEnabled: true,
        axisY: {
            tickThickness: 0,
            lineThickness: 0,
            valueFormatString: " ",
            gridThickness: 0
        },
        axisX: {
            tickThickness: 0,
            lineThickness: 0,
            labelFontSize: 18,
            labelFontColor: "Peru"

        },
        data: [
            {
                indexLabelFontSize: 14,
                toolTipContent: "<span style='\"'color: {color};'\"'><strong>{indexLabel}  </strong></span><span style='\"'font-size: 20px; color:peru '\"'><strong>{y}</strong></span>",

                indexLabelPlacement: "inside",
                indexLabelFontColor: "white",
                indexLabelFontWeight: 300,
                indexLabelFontFamily: "Helvetica Neue",
                color: "#999",
                type: "bar",
                dataPoints: AllWordsHist_forChart
            }
        ]

    });



    var FillerWords_sortable = [];
    for (var word in fillerwordsUsedSoFar) {
        FillerWords_sortable.push([word, fillerwordsUsedSoFar[word]]);
    }
    FillerWords_sortable.sort(function (a, b) {
        return a[1] - b[1]
    });

    console.log(fillerwordsUsedSoFar);
    console.log(FillerWords_sortable);

    var FillerWordsHist_forChart = [];
    for (var i = 0; i < FillerWords_sortable.length; i++) {
        FillerWordsHist_forChart.push({
            y: FillerWords_sortable[i][1],
            label: "" + FillerWords_sortable[i][1],
            indexLabel: FillerWords_sortable[i][0]
        });
    }

    $("#fillerWordGraph").CanvasJSChart({ //Pass chart options
        title: {
            text: "Filler words you used",
            fontFamily: 'Oswald',
            fontColor: "#555555",
            fontWeight: 300,
            fontSize: 28

        },
        animationEnabled: true,
        axisY: {
            tickThickness: 0,
            lineThickness: 0,
            valueFormatString: " ",
            gridThickness: 0
        },
        axisX: {
            tickThickness: 0,
            lineThickness: 0,
            labelFontSize: 18,
            labelFontColor: "Peru"

        },
        data: [
            {
                indexLabelFontSize: 14,
                toolTipContent: "<span style='\"'color: {color};'\"'><strong>{indexLabel}  </strong></span><span style='\"'font-size: 20px; color:peru '\"'><strong>{y}</strong></span>",

                indexLabelPlacement: "inside",
                indexLabelFontColor: "white",
                indexLabelFontWeight: 300,
                indexLabelFontFamily: "Helvetica Neue",
                color: "#62C9C3",
                type: "bar",
                dataPoints: FillerWordsHist_forChart
            }
        ]

    });


    $("#fillerWordGraph").show();
    $("#allWordGraph").show();

    console.log("recognition stopped");
}


var two_line = /\n\n/g;
var one_line = /\n/g;

function linebreak(s) {
    return s.replace(two_line, '<p></p>').replace(one_line, '<br>');
}
var first_char = /\S/;

function capitalize(s) {
    return s.replace(first_char, function (m) {
        return m.toUpperCase();
    });
}