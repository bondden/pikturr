(function () {

    "use strict";

    const fs = require('fs')
    const SwaggerParser = require('swagger-parser')
    const swaggerParser = new SwaggerParser()
    const plantuml = require('node-plantuml')


    const internals = {}

    internals.plant_writeStartUml = function () {
        return '@startuml\n\n';
    }

    internals.plant_writeTitle = function (apiTree, pc) {
        return pc + 'title ' + apiTree.title + ' - Version ' + apiTree.version + '\n\n';
    }

    internals.plant_writeEndUml = function (pc) {
        return pc + '@enduml\n';
    }

    internals.plant_writeRessourceClasses = function (apiTree, pc) {

        var s = pc;
        var ressourceTree = apiTree;

        for (var r in ressourceTree.ressources) {
            if (ressourceTree.ressources.hasOwnProperty(r)) {
                s = internals.plant_writeRessourceClass(r, apiTree.title, ressourceTree.ressources[r], s);
            }
        }

        return s;

    }

    internals.plant_writeRessourceClass = function (ressource, parent, subRessources, pc) {
        var s = pc;
        s += 'class "' + ressource + '" <<ressource>> {\n';
        // add http_verbs as methods
        s += '__ http __\n';
        for (var v in subRessources.http_verbs) {

            if (!subRessources.http_verbs.hasOwnProperty(v)) continue;

            s += v + '(';
            for (var param in subRessources.http_verbs[v].params) {

                if (!subRessources.http_verbs[v].params.hasOwnProperty(param)) continue;

                s += param + ',';
            }
            if (s[s.length - 1] == ',') {
                s = s.slice(0, -1);
            }
            s += ')\n';
        }

        // end of class
        s += '}\n\n';
        s += '"' + parent + '" --> "' + ressource + '"\n\n';

        for (var r in subRessources) {
            if (r == 'http_verbs') continue;
            if (subRessources.hasOwnProperty(r)) {
                s = internals.plant_writeRessourceClass(r, ressource, subRessources[r], s);
            }
        }

        return s;
    }

    internals.plant_writeApiClass = function (apiTree, pc) {
        var s = pc;
        s += 'class "' + apiTree.title + '" <<api>>\n\n';
        return s;
    }

    /*
    Die relevanten Informationen werden aus der swagger API
    Struktur extrahiert und für die Transformation in die Ausgabeformate
    in eine Zwischenstruktur überführt.
     */
    internals.extractApiData = function (api, cb) {

        var valid_http_verbs = ['get', 'put', 'post', 'delete', 'head', 'options', 'patch'];
        var ressourceTree = {};
        ressourceTree.ressources = {};
        ressourceTree.title = api.info.title;
        ressourceTree.version = api.info.version;

        for (var p in api.paths) {
            if (api.paths.hasOwnProperty(p)) {
                // Pfadangabe muss mit Slash starten
                if (p[0] == '/') {

                    // Pfad in URI-Teile zerlegen
                    var pathSegments = p.split('/');
                    // Leere Elemente entfernen
                    pathSegments = pathSegments.filter(function (n) { return n != '' });

                    var root = ressourceTree.ressources;

                    for (var r in pathSegments) {
                        if (!pathSegments.hasOwnProperty(r)) continue;

                        var prop = pathSegments[r];
                        if (root[prop] == undefined) {
                            root[prop] = {};
                        }

                        root = root[prop];
                    }
                    root.http_verbs = {};

                    for (var v in valid_http_verbs) {

                        if (!valid_http_verbs.hasOwnProperty(v)) continue;

                        if (api.paths[p][valid_http_verbs[v]] != undefined) {
                            root.http_verbs[valid_http_verbs[v]] = {};
                            root.http_verbs[valid_http_verbs[v]].params = {};
                            for (var param in api.paths[p][valid_http_verbs[v]].parameters) {

                                if (!api.paths[p][valid_http_verbs[v]].parameters.hasOwnProperty(param)) continue;

                                root.http_verbs[valid_http_verbs[v]].params[api.paths[p][valid_http_verbs[v]].parameters[param].name] = {};
                            }
                        }
                    }
                }
            }
        }

        ressourceTree.definitions = {};
        for (var d in api.definitions) {
            if (!api.definitions.hasOwnProperty(d)) continue;
            internals.addClassToApiData(api, ressourceTree, api.definitions[d], d);
        }

        cb(ressourceTree);
    }

    internals.addClassToApiData = function (api, ressourceTree, cls, name) {
        if (ressourceTree.definitions[name]) return;
        if (cls.allOf) internals.getClassExtensionInformation(api, ressourceTree, cls, name);
        if (cls.type !== 'object') return;

        var definition = ressourceTree.definitions[name] = {
            hasOne: [],
            hasMany: [],
            contains: [],
            properties: {}
        };
        if (cls.extends) {
            definition.extends = cls.extends;
        }
        for (var p in cls.properties) {

            if (!cls.properties.hasOwnProperty(p)) continue;

            let propOutput = definition.properties[p] = {};

            let prop = cls.properties[p];
            if (prop['$ref']) {
                propOutput.type = prop['$ref'].replace('#/definitions/', '');
                if (api.definitions[propOutput.type].type === 'object') {
                    definition.hasOne.push({
                        target: propOutput.type,
                        via: p
                    });
                } else {
                    propOutput.type += `<${api.definitions[propOutput.type].type}>`;
                }
            } else {
                propOutput.type = prop.type;
                switch (prop.type) {
                case 'array':
                    if (prop.items['$ref']) {
                        propOutput.arrayType = prop.items['$ref'].replace('#/definitions/', '');
                        if (api.definitions[propOutput.arrayType].type === 'object') {
                            definition.hasMany.push({
                                target: propOutput.arrayType,
                                via: p
                            });
                        } else {
                            propOutput.arrayType += `<${api.definitions[propOutput.arrayType].type}>`;
                        }
                        propOutput.type = propOutput.arrayType + '[]';
                    } else {
                        propOutput.arrayType = prop.items.type;
                        propOutput.type = propOutput.arrayType + '[]';
                        internals.addClassToApiData(api, ressourceTree, prop.items, name + '-' + p);
                        if (prop.items.type === 'object') {
                            definition.contains.push({
                                target: name + '-' + p,
                                via: p
                            });
                        }
                    }
                    break;
                case 'object':
                    internals.addClassToApiData(api, ressourceTree, prop, name + '-' + p);
                    definition.contains.push({
                        target: name + '-' + p,
                        via: p
                    });
                default:

                }
            }
        }
    }

    internals.getClassExtensionInformation = function(api, ressourceTree, cls, name) {
        let baseClassName = cls.allOf[0]['$ref'].replace('#/definitions/', '');
        let baseClass = api.definitions[baseClassName];
        if (!ressourceTree[baseClassName]) {
            internals.addClassToApiData(api, ressourceTree, baseClass, baseClassName);
        }
        Object.assign(cls, baseClass);
        //NB starting from 1
        for (var i = 1; i < cls.allOf.length; i++) {
            Object.assign(cls, cls.allOf[i]);
        }
        delete cls.allOf;
        cls.extends = baseClassName;
    }

    internals.plant_writeRepresentationClasses = function (apiData, pc) {
        var s = pc;
        s += 'package Models <<Folder>> {\n';
        for (var d in apiData.definitions) {
            s += 'class "' + d + '" { \n';
            let props = apiData.definitions[d].properties;
            for (var p in props) {

                if (!props.hasOwnProperty(p)) continue;
                s += p + ' : ' + props[p].type + '\n';
            }
            s += '}\n';

            let hasMany = apiData.definitions[d].hasMany;
            for (var m of hasMany) {
                s += `"${d}" "${m.via}" -- "0..n" "${m.target}"\n`
            }
            let hasOne = apiData.definitions[d].hasOne;
            for (var o of hasOne) {
                s += `"${d}" "${o.via}" -- "1" "${o.target}"\n`
            }
            let contains = apiData.definitions[d].contains;
            for (var c of contains) {
                s += `"${c.target}" *- "${c.via}" "${d}"\n`
            }
            let ext = apiData.definitions[d].extends;
            if (ext) {
                s += `"${ext}" <|-- "${d}" : < extends\n`
            }
        }

        s += "}\n\n";

        return s;
    }

    internals.plant_writeSkinParams = function (pc) {
        var s = pc;

        s += 'skinparam stereotypeCBackgroundColor<<representation>> DimGray\n';
        s += 'skinparam stereotypeCBackgroundColor<<api>> Red\n';
        s += 'skinparam stereotypeCBackgroundColor<<ressource>> SpringGreen\n';

        s += 'skinparam class {\n';
        s += 'BackgroundColor<<api>> Yellow\n';
        s += 'BackgroundColor<<representation>> Silver\n';
        s += 'BackgroundColor<<ressource>> YellowGreen\n';
        s += '}\n\n';

        return s;
    }

    internals.plant_writeLegend = function (apiTree, pc) {
        var s = pc;
        var d = new Date();
        d.setHours(d.getHours() + 2);
        s += 'legend left\n';
        s += 'created with pikturr (https://github.com/nrekretep/pikturr)\n';
        s += d.toISOString() + '\n';
        s += 'endlegend\n\n';

        return s;
    }

    internals.convertToPlantUml = function (apiData) {
        var s = internals.plant_writeStartUml();
        s = internals.plant_writeTitle(apiData, s);
        s = internals.plant_writeSkinParams(s);
        s = internals.plant_writeApiClass(apiData, s);
        s = internals.plant_writeRessourceClasses(apiData, s);
        s = internals.plant_writeRepresentationClasses(apiData, s);
        // s = internals.plant_writeLegend(apiData, s);
        s = internals.plant_writeEndUml(s);

        var gen = plantuml.generate(s, { format: 'png' });
        gen.out.pipe(fs.createWriteStream('output-file.png'));
    }


    var pikturr = {};
    exports.generate = pikturr.generate = function (url) {
        swaggerParser.parse(url).then(function (api) {
            internals.extractApiData(api, internals.convertToPlantUml);
        }).catch(function (err) {
            console.log(err);
        })
    }

    if (!module.parent) {
        pikturr.generate(process.argv[2]);
    }

})();
