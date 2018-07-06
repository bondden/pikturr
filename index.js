"use strict";

const
  fs           =require('fs'),
  SwaggerParser=require('swagger-parser'),
  swaggerParser=new SwaggerParser(),
  plantuml     =require('node-plantuml'),
  
  internals={}
;

internals.plant_writeStartUml=function(){
  return '@startuml\n\n';
};

internals.plant_writeTitle=function(apiTree,pc){
  return `${pc} title ${apiTree.title} - Version ${apiTree.version}\n\n`;
};

internals.plant_writeEndUml=function(pc){
  return pc+'@enduml\n';
};

internals.plant_writeRessourceClasses=function(apiTree,pc){

  let 
    s            =pc,
    ressourceTree=apiTree
  ;

  for(let r in ressourceTree.ressources){
    if(ressourceTree.ressources.hasOwnProperty(r)){
      s=internals.plant_writeRessourceClass(r,apiTree.title,ressourceTree.ressources[r],s);
    }
  }

  return s;

};

internals.plant_writeRessourceClass=function(ressource,parent,subRessources,pc){
  
  var s=pc;
  s+='class "'+ressource+'" <<resource>> {\n';
  // add http_verbs as methods
  s+='__ http __\n';
  for(let v in subRessources.http_verbs){

    if(!subRessources.http_verbs.hasOwnProperty(v)) continue;

    s+=v+'(';
    for(let param in subRessources.http_verbs[v].params){

      if(!subRessources.http_verbs[v].params.hasOwnProperty(param)) continue;

      s+=param+',';
    }
    if(s[s.length-1]===','){
      s=s.slice(0,-1);
    }
    s+=')\n';
  }

  // end of class
  s+='}\n\n';
  s+='"'+parent+'" *-- "'+ressource+'"\n\n';

  for(let r in subRessources){
    if(r==='http_verbs') continue;
    if(subRessources.hasOwnProperty(r)){
      s=internals.plant_writeRessourceClass(r,ressource,subRessources[r],s);
    }
  }

  return s;
  
};

internals.plant_writeApiClass=function(apiTree,pc){
  
  return `
${pc}
class "${apiTree.title}" <<api>>
  `;
  
};

/*
Die relevanten Informationen werden aus der swagger API
Struktur extrahiert und für die Transformation in die Ausgabeformate
in eine Zwischenstruktur überführt.
 */
internals.extractApiData=function(api,cb,tgt,fmt,uml){

  const valid_http_verbs    =['get','put','post','delete','head','options','patch'];
  let ressourceTree       ={};
  ressourceTree.ressources={};
  ressourceTree.title     =api.info.title;
  ressourceTree.version   =api.info.version;

  for(let p in api.paths){
    if(api.paths.hasOwnProperty(p)){
      // Pfadangabe muss mit Slash starten
      if(p[0]==='/'){

        // Pfad in URI-Teile zerlegen
        let pathSegments=p.split('/');
        // Leere Elemente entfernen
        pathSegments    =pathSegments.filter(n=>{
          return n!='';
        });

        let root=ressourceTree.ressources;

        for(let r in pathSegments){
          if(!pathSegments.hasOwnProperty(r)) continue;

          let prop=pathSegments[r];
          if(root[prop]==undefined){
            root[prop]={};
          }

          root=root[prop];
        }
        root.http_verbs={};

        for(let v in valid_http_verbs){

          if(!valid_http_verbs.hasOwnProperty(v)) continue;

          if(api.paths[p][valid_http_verbs[v]]!=undefined){
            root.http_verbs[valid_http_verbs[v]]       ={};
            root.http_verbs[valid_http_verbs[v]].params={};
            for(var param in api.paths[p][valid_http_verbs[v]].parameters){

              if(!api.paths[p][valid_http_verbs[v]].parameters.hasOwnProperty(param)) continue;

              root.http_verbs[valid_http_verbs[v]].params[api.paths[p][valid_http_verbs[v]].parameters[param].name]={};
            }
          }
        }
      }
    }
  }

  ressourceTree.definitions={};
  for(let d in api.definitions){
    if(!api.definitions.hasOwnProperty(d)) continue;
    internals.addClassToApiData(api,ressourceTree,api.definitions[d],d);
  }

  cb(ressourceTree,tgt,fmt,uml);
};

internals.addClassToApiData=function(api,ressourceTree,cls,name){
  if(ressourceTree.definitions[name]) return;
  if(cls.allOf) internals.getClassExtensionInformation(api,ressourceTree,cls,name);
  if(cls.type!=='object') return;

  let definition=ressourceTree.definitions[name]={
    hasOne:    [],
    hasMany:   [],
    contains:  [],
    properties:{}
  };
  if(cls.extends){
    definition.extends=cls.extends;
  }
  for(let p in cls.properties){

    if(!cls.properties.hasOwnProperty(p)) continue;

    let propOutput=definition.properties[p]={};

    let prop=cls.properties[p];
    if(prop['$ref']){
      propOutput.type=prop['$ref'].replace('#/definitions/','');
      if(api.definitions[propOutput.type].type==='object'){
        definition.hasOne.push({
          target:propOutput.type,
          via:   p
        });
      }else{
        propOutput.type+=`<${api.definitions[propOutput.type].type}>`;
      }
    }else{
      propOutput.type=prop.type;
      switch(prop.type){
        case 'array':
          if(prop.items['$ref']){
            propOutput.arrayType=prop.items['$ref'].replace('#/definitions/','');
            if(api.definitions[propOutput.arrayType].type==='object'){
              definition.hasMany.push({
                target:propOutput.arrayType,
                via:   p
              });
            }else{
              propOutput.arrayType+=`<${api.definitions[propOutput.arrayType].type}>`;
            }
            propOutput.type=propOutput.arrayType+'[]';
          }
          break;
        case 'object':
          internals.addClassToApiData(api,ressourceTree,prop,name+'-'+p);
          definition.contains.push({
            target:name+'-'+p,
            via:   p
          });
          break;
        default:

      }
    }
  }
};

internals.getClassExtensionInformation=function(api,ressourceTree,cls,name){
  
  let baseClassName=cls.allOf[0]['$ref'].replace('#/definitions/','');
  let baseClass    =api.definitions[baseClassName];
  if(!ressourceTree[baseClassName]){
    internals.addClassToApiData(api,ressourceTree,baseClass,baseClassName);
  }
  Object.assign(cls,baseClass,cls.allOf[1]);
  delete cls.allOf;
  cls.extends=baseClassName;
  
};

internals.plant_writeRepresentationClasses=function(apiData,pc){
  
  let s=pc;
  s+='package Models <<Folder>> {\n';
  for(let d in apiData.definitions){
    s+='class "'+d+'" { \n';
    let props=apiData.definitions[d].properties;
    for(let p in props){

      if(!props.hasOwnProperty(p)) continue;
      s+=p+' : '+props[p].type+'\n';
    }
    s+='}\n';

    let hasMany=apiData.definitions[d].hasMany;
    for(let m of hasMany){
      s+=`"${d}" "${m.via}" -- "0..n" "${m.target}"\n`;
    }
    let hasOne=apiData.definitions[d].hasOne;
    for(let o of hasOne){
      s+=`"${d}" "${o.via}" -- "1" "${o.target}"\n`;
    }
    let contains=apiData.definitions[d].contains;
    for(let c of contains){
      s+=`"${c.target}" *- "${c.via}" "${d}"\n`;
    }
    let ext=apiData.definitions[d].extends;
    if(ext){
      s+=`"${ext}" <|-- "${d}" : < extends\n`;
    }
  }

  s+="}\n\n";

  return s;
  
};

internals.plant_writeSkinParams=function(pc){
  
  return `
${pc}

!definelong STY_DFT
  border {
    thickness 1
  }
  font {
    name "Ubuntu mono"
  }
!enddefinelong

skinparam {
  shadowing false
  monochrome true
  default {
    STY_DFT
  }
  class {
    STY_DFT
    background {
      color<<api>> Yellow
      color<<representation>> Silver
      color<<resource>> YellowGreen
    }
  }
  stereotype {
    C {
      background {
        color<<representation>> DimGray
        color<<api>> Red
        color<<resource>> SpringGreen
      }
    }
  }
}

hide empty members
hide empty methods
hide empty fields
'hide circles

header

  updated:  %date[yyyy.MM.dd HH:mm]%

end header

footer

  © ITMS.PRO %date[yyyy]%
end footer

  `;
  
};

internals.plant_writeLegend=function(apiTree,pc){
  
  const d=new Date();
  d.setHours(d.getHours()+2);

  return `
${pc}

legend left
  created with pikturr (https://github.com/nrekretep/pikturr)
  ${d.toISOString()}
end legend

  `;
};

internals.convertToPlantUml=function(apiData,tgt='output-file.png',fmt='png',uml=true){
  
  let s=internals.plant_writeStartUml();
  s    =internals.plant_writeSkinParams(s);
  s    =internals.plant_writeTitle(apiData,s);
  s    =internals.plant_writeApiClass(apiData,s);
  s    =internals.plant_writeRessourceClasses(apiData,s);
  s    =internals.plant_writeRepresentationClasses(apiData,s);
  // s = internals.plant_writeLegend(apiData, s);
  s    =internals.plant_writeEndUml(s);
  
  if(uml){
    fs.writeFile(tgt.replace(/\.(svg|png)$/i,'.puml'),s,{encoding:'utf8'},e=>{
      if(e)throw e;
    });
  }

  const gen=plantuml.generate(s,{format:fmt});
  gen.out.pipe(fs.createWriteStream(tgt));
  
};

var pikturr     ={};

exports.generate=pikturr.generate=function(url,tgt='output-file.png',fmt='png',uml=true){
  
  swaggerParser
    .parse(url)
    .then(api=>{
      internals.extractApiData(api,internals.convertToPlantUml,tgt,fmt,uml);
    })
    .catch(e=>{
      console.log(e);
    })
  ;
  
};

if(!module.parent){
  pikturr.generate(
    process.argv[2],
    process.argv[3]||'output-file.png',
    process.argv[4]||'png',
    process.argv[5]||true
  );
}
