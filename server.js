/**
 * Created by Latana on 2015-09-23.
 */
var application_root = __dirname,
    express = require('express'), //Web framework
    morgan = require('morgan'), // (since Express 4.0.0)
    bodyParser = require('body-parser'), // (since Express 4.0.0)
    errorHandler = require('errorhandler'), // (since Express 4.0.0)
    path = require('path'), // Utilities for dealing with file
    request = require('request'),
    fs = require('fs'),
    unirest = require('unirest'),
    app = express(),
    mongo = require('mongodb'),
    monk = require('monk'),
    db = monk('localhost:27017/test'), // 27017
    router = express.Router();

var env = process.env.NODE_ENV || 'development';


app.use('/', express.static(path.join(application_root, 'app')));
app.use(morgan('dev'));
app.use(bodyParser());
app.use(errorHandler({dumpExceptions: true, showStack: true}));


//Start server
var ipaddr = process.env.OPENSHIFT_NODEJS_IP || "127.0.0.1";
var port = parseInt(process.env.OPENSHIFT_NODEJS_PORT) || 8000;

app.set('ipaddr', ipaddr);
app.set('port', port);

app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');


var server = app.listen(port, ipaddr, function () {
    console.log('Express server listening on port %d in %s mode',
        port, app.settings.env);
});


//var io = require('socket.io').listen(server, {origins:'*:*'});
var io = require('socket.io').listen(server);

// Namn på collection's

var gameSearch = "gameSearch";
var topFive = "topFive";

/**
 *  Startar när användaren anländer till webbplatsen.
 * Kontrollerar om det finns någon data i sök collection, tar bort alla id och sänder ut det till klienten.
 */
io.on("connection", function(socket){

    socket.on('localStore', function(){

        var collection = db.get(gameSearch);

        collection.find({}, function (err, data) {

            if(data !== undefined && data.length !== 0) {

                data.forEach(function (element) {
                    delete element._id;
                });
                socket.emit('localStore', data);
            }
            else{

                data = null;
                socket.emit('localStore', data);
            }
        });
    });

    /**
     * Kontrollerar om det finns någon data i top 5 listan och sänder ut det till klienten
     */
    socket.on('top-Five', function(){

        var collection = db.get(topFive);

        collection.find({}, function (err, data) {

            if(data !== undefined && data.length !== 0) {

                socket.emit('top-Five', data);
            }
        });
    });

    /**
     * @param data object
     * Undersöker om titeln finns i databasen och gämför med timestamp. Om inte så görs ett anrop mot apierna.
     */
    socket.on('search', function (data) {

        var search = data.search.toLowerCase();

        var collection = db.get(gameSearch);

        if(search !== undefined || search !== "") {

            var query = { title: new RegExp('^' + search) };

            // Hämtar liknande titlar
            collection.find(query,function(err, data){

                var date = new Date();
                var dateNow = date.getTime();

                if (data !== undefined && data.length !== 0) {

                    var timeStampToLow = false;

                    // Är någon hämtad titel för gammal hämtas nytt
                    for (var i = 0; i < data.length; i++) {

                        if (Number(data[i]['timestamp']) < Number(dateNow)) {
                            timeStampToLow = true;
                            break;
                        }
                    }
                    if(timeStampToLow === true) {
                        getIgn(search, socket);
                    }
                    else{
                        socket.emit('render', data);
                    }
                }
                else {
                    getIgn(search, socket);
                }
            });
        }
    });
});

/**
 *
 * @param search string
 * @param socketToSendTo object
 * Gör ett anrop mot ign och om det inte blir något resultat kontrollerar systemet i databasen igen.
 */
function getIgn(search, socketToSendTo) {

    unirest.get("https://videogamesrating.p.mashape.com/get.php?count=20&game='" + search + "'")
     .header("X-Mashape-Key", "oQopOIzEoFmshZ16zfCacBQp5Na6p1MevmSjsnHkfEBn5ay2FF")
     .end(function (result) {

            if(typeof result.error === 'object' || result.body.length === 0){

                findInDataBase(search, socketToSendTo);
            }
            else{

                getOmdb(search, result.body, socketToSendTo);
            }
    });
}

/**
 *
 * @param search String
 * @param ignArray Array
 * @param socketToSendTo Object
 *
 * Gör ett anrop mot omdb's api och kallar på mashup när den är klar
 * Om den inte hittar något kollar systemet i databasen igen.
 */
function getOmdb(search, ignArray, socketToSendTo) {

    var omdbArray = [];
    var count = 0;

    for(var i = 0; i < ignArray.length; i++){

        var ignSearch = ignArray[i].title;
        ignSearch = ignSearch.replace(/ /g, '+');

                    // http://www.omdbapi.com/?t=mass+effect&y=&plot=full&r=json
        unirest.get("http://www.omdbapi.com/?t=" + ignSearch + "&y=&plot=full&r=json")
        //unirest.get("http://www.omdbapi.com/?t=Mass+Effect&y=&plot=full&r=json")
            .end(function (result) {

                count++;

                if(typeof result.error === 'object' && count === ignArray.length){

                    findInDataBase(search, socketToSendTo);
                }
                var temp = result.body;

                if (temp['Response'] === "True" && temp['Type'] === "game") {

                    omdbArray.push(temp);
                }
                // Kommer in när loopen är klar
                if (count === ignArray.length) {

                    if (omdbArray.length === 0) {

                        findInDataBase(search, socketToSendTo);
                    }
                    else {
                        mashup(ignArray, omdbArray, socketToSendTo);
                    }
                }
            });
    }
}

/**
 *
 * @param hybridArray array
 * Sparar ner mashapen i en databas och sätter en timestamp på 5 min
 */
function storeInDataBase(hybridArray) {

    var collection = db.get(gameSearch);

    // Kollar i databasen
    collection.find({}, function (err, data) {

        var count = 0;
        var tempArray = [];
        var deleteArray = [];
        var dataArray = [];

        // Om det inte finns någon data
        if(data === undefined || data.length === 0){

            hybridArray.forEach(function (newObj) {

                dataArray.push(newObj);
            });

            dataArray.forEach(function (element) {
                collection.insert(element);
            });
        }
        else {
            //Förnyar titlar som finns och lägger in titlar som inte finns
            hybridArray.forEach(function (newObj) {
                data.every(function (oldObj) {

                    count++;

                    if (oldObj.title === newObj.title) {

                        tempArray.push(newObj);
                        deleteArray.push(oldObj);

                        return false; //Break every-loop
                    }
                    if (count === data.length) {

                        tempArray.push(newObj);

                        return false; //Break every-loop
                    }
                    return true; //Continue every-loop
                });
                count = 0;
            });

            // Tar bort de id'n som ska förnyas
            deleteArray.forEach(function(element) {
                collection.remove({_id: element._id});
            });

            // Lägger till titlar
            tempArray.forEach(function (element) {
                collection.insert(element, function (err) {

                    if (err) {
                        console.log("There was a problem adding the information to the database.");
                    }
                });
            });
        }
    });
}

/**
 *
 * @param ignArray array
 * @param omdbArray Array
 * @param socketToSendTo Object
 *
 * Lägger ihop de delar jag vill behålla och sätter ihopa poängen för att få ut snittet.
 * Kallar på storeInDataBase och skickar sedan data till klienten.
 */
function mashup(ignArray, omdbArray, socketToSendTo) {

    var hybridArray = [];

    var getTime = new Date();
    var year = getTime.getFullYear();
    var month = getTime.getMonth() + 1;
    var day = getTime.getDate();
    var hour = getTime.getHours();
    var min = getTime.getMinutes();

    month = lessThenTen(month);
    day = lessThenTen(day);

    var lastUpdate = year +"-"+ month + "-" + day;

    //Lägger ihopa informationen till hybrid och sedan pushar in hybrid i hybridArray
    ignArray.forEach(function(ignObject){
        omdbArray.every(function (omdbObject) {
            if(ignObject.title === omdbObject.Title){

                var hybrid = {};

                hybrid['title'] = ignObject['title'].toLowerCase();
                hybrid['released'] = checkValue(omdbObject['Released']);

                if(ignObject['score'] === "" || omdbObject['imdbRating'] === "N/A"){

                    hybrid['score'] = "No information";
                }
                else{
                    hybrid['score'] = (Number(ignObject['score']) + Number(omdbObject['imdbRating'])) / 2;
                }

                hybrid['description'] = checkValue(omdbObject['Plot']);
                hybrid['publisher'] = checkValue(ignObject['publisher']);
                hybrid['pic'] = ignObject['thumb'];

                // Platform lopas igenom för att sätta ihop till en sträng
                for (i in ignObject['platforms']) {

                    if (hybrid['platform'] == undefined) {

                        hybrid['platform'] = (ignObject['platforms'][i]);
                    }
                    else {
                        hybrid['platform'] += ( ", " + ignObject['platforms'][i]);
                    }
                }
                var date = new Date();

                // Sätter timestamp och när den uppdaterades
                hybrid['timestamp'] = Number(date.getTime() + 300000);
                hybrid['lastUpdate'] = lastUpdate;

                hybridArray.push(hybrid);

                return false; //Break every-loop
            }
            return true; //Continue every-loop
        });
    });

    // Skriver ut meddelande om det inte blir någon mashup
    if(hybridArray.length === 0){
        var message = "Could not find a match";
        socketToSendTo.emit('render', message);
    }
    else {
        // Sparar i databaserna och skickar till klienten
        storeInDataBase(hybridArray);
        checkTopFive(hybridArray);
        socketToSendTo.emit('render', hybridArray);
    }
}

/**
 * @param hybridArray Array
 * Kollar upp top 5 listan och lägger till resultat ifall listan är mindre än 5.
 * Om listan är full så kontrollerar den ifall poängen är högre.
 */
function checkTopFive(hybridArray){

    var collection = db.get(topFive);

    // Kollar i top-five databasen
    collection.find({}, function (err, data) {

        // Om listan är tom så läggs alla spel som har poäng till i listan.
        if(data.length === 0){

            hybridArray.forEach(function (newObj) {

                if(newObj.score !== "No information") {
                    data.push(newObj);
                }
            });
            // Datan sorteras efter poäng och de 5 översta plockas ut
            data = spliceData(sortData(data));

            // Sparar i databasen
            data.forEach(function (element) {
                collection.insert(element, function(err,doc){

                    if(err){
                        console.log("There was a problem adding the information to the database.");
                    }
                });
            });
        }
        else{
            var tempArray = [];
            var count = 0;
            data = sortData(data);

            // Plockar ut de titlar som är unika och har poäng
            hybridArray.forEach(function (newObj) {
                data.every(function (oldObj) {

                    count ++;

                    if(oldObj.title === newObj.title) {
                        return false; //Break every-loop
                    }
                    if (count === data.length && newObj.score !== "No information") {
                        tempArray.push(newObj);
                        return false; //Break every-loop
                    }
                    return true; //Continue every-loop
                });
                count = 0;
            });
            // Stoppar in tempArray in i data, sorterar och plockar ut de 5 översta.
            data = pushData(data, tempArray);
            data = sortData(data);
            data = spliceData(data);

            collection.remove(function(){

                // Om datan har något id tas det bort och sen sparas det i databasen.
                data.forEach(function (element) {

                    if(element._id) {
                        delete element._id;
                    }
                    collection.insert(element, function(err,doc){

                        if(err){
                            console.log("There was a problem adding the information to the database.");
                        }
                    });
                });
            });
        }
    });
}

/**
 *
 * @param data Array
 * @returns Array
 * Sorterar data på score
 */
function sortData(data){

    data = data.sort(function(obj1, obj2) {
        return Number(obj2['score']) - Number(obj1['score']);
    });
    return data;
}

/**
 *
 * @param data
 * @returns Array
 * Hämtar ut de 5 översta
 */
function spliceData(data){

    data = data.slice(0, 5);

    return data;
}

/**
 *
 * @param data Array
 * @param tempArray Array
 * @returns Array
 * Stoppar in all data från tempArray till data
 */
function pushData(data, tempArray){

    for(var i = 0; i < tempArray.length; i++){

        data.push(tempArray[i]);
    }

    return data;
}

/**
 *
 * @param string string
 * @returns string
 * Sätter no information om det inte finns någon
 */
function checkValue(string){

    if(string === "N/A" || string === ""){

        string = "No information";
    }
    return string;
}

/**
 *
 * @param search string
 * @param socketToSendTo Object
 *
 * Letar upp om datan finns i databasen och sänder datan till klienten.
 * Annars skickas ett meddelande.
 */
function findInDataBase(search, socketToSendTo){

    var query = { title: new RegExp('^' + search) };
    var collection = db.get(gameSearch);
    collection.find(query,function(err, data) {

        if(data.length === 0){
            var message = "The game could not be found";
            socketToSendTo.emit('render', message);
        }
        else{
            socketToSendTo.emit('render', data);
        }
    });
}

/**
 *
 * @param int int
 * @returns int
 *
 * Kontrollerar ifall int'en är mindre än 10 och lägger till en 0 framför.
 */
function lessThenTen(int){

    if(int < 10){
        int = '0' + int;
    }
    return int;
}

/**
 * Visar felsida
 */
app.use(function(req, res) {
    res.status(404);

    if (req.accepts('html')) {
        res.render('404', {url: req.url});
    }
});