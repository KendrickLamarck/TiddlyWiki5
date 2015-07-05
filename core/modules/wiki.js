/*\
title: $:/core/modules/wiki.js
type: application/javascript
module-type: wikimethod

Extension methods for the $tw.Wiki object

Adds the following properties to the wiki object:

* `eventListeners` is a hashmap by type of arrays of listener functions
* `changedTiddlers` is a hashmap describing changes to named tiddlers since wiki change events were last dispatched. Each entry is a hashmap containing two fields:
	modified: true/false
	deleted: true/false
* `changeCount` is a hashmap by tiddler title containing a numerical index that starts at zero and is incremented each time a tiddler is created changed or deleted
* `caches` is a hashmap by tiddler title containing a further hashmap of named cache objects. Caches are automatically cleared when a tiddler is modified or deleted
* `globalCache` is a hashmap by cache name of cache objects that are cleared whenever any tiddler change occurs

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var widget = require("$:/core/modules/widgets/widget.js");

var USER_NAME_TITLE = "$:/status/UserName";

/*
Get the value of a text reference. Text references can have any of these forms:
	<tiddlertitle>
	<tiddlertitle>!!<fieldname>
	!!<fieldname> - specifies a field of the current tiddlers
	<tiddlertitle>##<index>
*/
exports.getTextReference = function(textRef,defaultText,currTiddlerTitle) {
	var tr = $tw.utils.parseTextReference(textRef),
		title = tr.title || currTiddlerTitle;
	if(tr.field) {
		var tiddler = this.getTiddler(title);
		if(tr.field === "title") { // Special case so we can return the title of a non-existent tiddler
			return title;
		} else if(tiddler && $tw.utils.hop(tiddler.fields,tr.field)) {
			return tiddler.getFieldString(tr.field);
		} else {
			return defaultText;
		}
	} else if(tr.index) {
		return this.extractTiddlerDataItem(title,tr.index,defaultText);
	} else {
		return this.getTiddlerText(title,defaultText);
	}
};

exports.setTextReference = function(textRef,value,currTiddlerTitle) {
	var tr = $tw.utils.parseTextReference(textRef),
		title = tr.title || currTiddlerTitle;
	this.setText(title,tr.field,tr.index,value);
};

exports.setText = function(title,field,index,value) {
	// Check if it is a reference to a tiddler field
	if(index) {
		var data = this.getTiddlerData(title,Object.create(null));
		data[index] = value;
		this.setTiddlerData(title,data,this.getModificationFields());
	} else {
		var tiddler = this.getTiddler(title),
			fields = {title: title};
		fields[field || "text"] = value;
		this.addTiddler(new $tw.Tiddler(tiddler,fields,this.getModificationFields()));
	}
};

exports.deleteTextReference = function(textRef,currTiddlerTitle) {
	var tr = $tw.utils.parseTextReference(textRef),
		title,tiddler,fields;
	// Check if it is a reference to a tiddler
	if(tr.title && !tr.field) {
		this.deleteTiddler(tr.title);
	// Else check for a field reference
	} else if(tr.field) {
		title = tr.title || currTiddlerTitle;
		tiddler = this.getTiddler(title);
		if(tiddler && $tw.utils.hop(tiddler.fields,tr.field)) {
			fields = Object.create(null);
			fields[tr.field] = undefined;
			this.addTiddler(new $tw.Tiddler(tiddler,fields,this.getModificationFields()));
		}
	}
};

exports.addEventListener = function(type,listener) {
	this.eventListeners = this.eventListeners || {};
	this.eventListeners[type] = this.eventListeners[type]  || [];
	this.eventListeners[type].push(listener);	
};

exports.removeEventListener = function(type,listener) {
	var listeners = this.eventListeners[type];
	if(listeners) {
		var p = listeners.indexOf(listener);
		if(p !== -1) {
			listeners.splice(p,1);
		}
	}
};

exports.dispatchEvent = function(type /*, args */) {
	var args = Array.prototype.slice.call(arguments,1),
		listeners = this.eventListeners[type];
	if(listeners) {
		for(var p=0; p<listeners.length; p++) {
			var listener = listeners[p];
			listener.apply(listener,args);
		}
	}
};

/*
Causes a tiddler to be marked as changed, incrementing the change count, and triggers event handlers.
This method should be called after the changes it describes have been made to the wiki.tiddlers[] array.
	title: Title of tiddler
	isDeleted: defaults to false (meaning the tiddler has been created or modified),
		true if the tiddler has been deleted
*/
exports.enqueueTiddlerEvent = function(title,isDeleted) {
	// Record the touch in the list of changed tiddlers
	this.changedTiddlers = this.changedTiddlers || Object.create(null);
	this.changedTiddlers[title] = this.changedTiddlers[title] || Object.create(null);
	this.changedTiddlers[title][isDeleted ? "deleted" : "modified"] = true;
	// Increment the change count
	this.changeCount = this.changeCount || Object.create(null);
	if($tw.utils.hop(this.changeCount,title)) {
		this.changeCount[title]++;
	} else {
		this.changeCount[title] = 1;
	}
	// Trigger events
	this.eventListeners = this.eventListeners || {};
	if(!this.eventsTriggered) {
		var self = this;
		$tw.utils.nextTick(function() {
			var changes = self.changedTiddlers;
			self.changedTiddlers = Object.create(null);
			self.eventsTriggered = false;
			if($tw.utils.count(changes) > 0) {
				self.dispatchEvent("change",changes);
			}
		});
		this.eventsTriggered = true;
	}
};

exports.getSizeOfTiddlerEventQueue = function() {
	return $tw.utils.count(this.changedTiddlers);
};

exports.clearTiddlerEventQueue = function() {
	this.changedTiddlers = Object.create(null);
	this.changeCount = Object.create(null);
};

exports.getChangeCount = function(title) {
	this.changeCount = this.changeCount || Object.create(null);
	if($tw.utils.hop(this.changeCount,title)) {
		return this.changeCount[title];
	} else {
		return 0;
	}
};

/*
Generate an unused title from the specified base
*/
exports.generateNewTitle = function(baseTitle,options) {
	options = options || {};
	var c = 0,
		title = baseTitle;
	while(this.tiddlerExists(title) || this.isShadowTiddler(title) || this.findDraft(title)) {
		title = baseTitle + 
			(options.prefix || " ") + 
			(++c);
	}
	return title;
};

exports.isSystemTiddler = function(title) {
	return title.indexOf("$:/") === 0;
};

exports.isTemporaryTiddler = function(title) {
	return title.indexOf("$:/temp/") === 0;
};

exports.isImageTiddler = function(title) {
	var tiddler = this.getTiddler(title);
	if(tiddler) {		
		var contentTypeInfo = $tw.config.contentTypeInfo[tiddler.fields.type || "text/vnd.tiddlywiki"];
		return !!contentTypeInfo && contentTypeInfo.flags.indexOf("image") !== -1;
	} else {
		return null;
	}
};

/*
Like addTiddler() except it will silently reject any plugin tiddlers that are older than the currently loaded version. Returns true if the tiddler was imported
*/
exports.importTiddler = function(tiddler) {
	var existingTiddler = this.getTiddler(tiddler.fields.title);
	// Check if we're dealing with a plugin
	if(tiddler && tiddler.hasField("plugin-type") && tiddler.hasField("version") && existingTiddler && existingTiddler.hasField("plugin-type") && existingTiddler.hasField("version")) {
		// Reject the incoming plugin if it is older
		if(!$tw.utils.checkVersions(tiddler.fields.version,existingTiddler.fields.version)) {
			return false;
		}
	}
	// Fall through to adding the tiddler
	this.addTiddler(tiddler);
	return true;
};

/*
Return a hashmap of the fields that should be set when a tiddler is created
*/
exports.getCreationFields = function() {
	var fields = {
			created: new Date()
		},
		creator = this.getTiddlerText(USER_NAME_TITLE);
	if(creator) {
		fields.creator = creator;
	}
	return fields;
};

/*
Return a hashmap of the fields that should be set when a tiddler is modified
*/
exports.getModificationFields = function() {
	var fields = Object.create(null),
		modifier = this.getTiddlerText(USER_NAME_TITLE);
	fields.modified = new Date();
	if(modifier) {
		fields.modifier = modifier;
	}
	return fields;
};

/*
Return a sorted array of tiddler titles.  Options include:
sortField: field to sort by
excludeTag: tag to exclude
includeSystem: whether to include system tiddlers (defaults to false)
*/
exports.getTiddlers = function(options) {
	options = options || Object.create(null);
	var self = this,
		sortField = options.sortField || "title",
		tiddlers = [], t, titles = [];
	this.each(function(tiddler,title) {
		if(options.includeSystem || !self.isSystemTiddler(title)) {
			if(!options.excludeTag || !tiddler.hasTag(options.excludeTag)) {
				tiddlers.push(tiddler);
			}
		}
	});
	tiddlers.sort(function(a,b) {
		var aa = a.fields[sortField].toLowerCase() || "",
			bb = b.fields[sortField].toLowerCase() || "";
		if(aa < bb) {
			return -1;
		} else {
			if(aa > bb) {
				return 1;
			} else {
				return 0;
			}
		}
	});
	for(t=0; t<tiddlers.length; t++) {
		titles.push(tiddlers[t].fields.title);
	}
	return titles;
};

exports.countTiddlers = function(excludeTag) {
	var tiddlers = this.getTiddlers({excludeTag: excludeTag});
	return $tw.utils.count(tiddlers);
};

/*
Returns a function iterator(callback) that iterates through the specified titles, and invokes the callback with callback(tiddler,title)
*/
exports.makeTiddlerIterator = function(titles) {
	var self = this;
	if(!$tw.utils.isArray(titles)) {
		titles = Object.keys(titles);
	} else {
		titles = titles.slice(0);
	}
	return function(callback) {
		titles.forEach(function(title) {
			callback(self.getTiddler(title),title);
		});
	};
};

/*
Sort an array of tiddler titles by a specified field
	titles: array of titles (sorted in place)
	sortField: name of field to sort by
	isDescending: true if the sort should be descending
	isCaseSensitive: true if the sort should consider upper and lower case letters to be different
*/
exports.sortTiddlers = function(titles,sortField,isDescending,isCaseSensitive,isNumeric) {
	var self = this;
	titles.sort(function(a,b) {
		var x,y,
			compareNumbers = function(x,y) {
				var result = 
					isNaN(x) && !isNaN(y) ? (isDescending ? -1 : 1) :
					!isNaN(x) && isNaN(y) ? (isDescending ? 1 : -1) :
					                        (isDescending ? y - x :  x - y);
				return result;
			};
		if(sortField !== "title") {
			var tiddlerA = self.getTiddler(a),
				tiddlerB = self.getTiddler(b);
			if(tiddlerA) {
				a = tiddlerA.fields[sortField] || "";
			} else {
				a = "";
			}
			if(tiddlerB) {
				b = tiddlerB.fields[sortField] || "";
			} else {
				b = "";
			}
		}
		x = Number(a);
		y = Number(b);
		if(isNumeric && (!isNaN(x) || !isNaN(y))) {
			return compareNumbers(x,y);
		} else if($tw.utils.isDate(a) && $tw.utils.isDate(b)) {
			return isDescending ? b - a : a - b;
		} else {
			a = String(a);
			b = String(b);
			if(!isCaseSensitive) {
				a = a.toLowerCase();
				b = b.toLowerCase();
			}
			return isDescending ? b.localeCompare(a) : a.localeCompare(b);
		}
	});
};

/*
For every tiddler invoke a callback(title,tiddler) with `this` set to the wiki object. Options include:
sortField: field to sort by
excludeTag: tag to exclude
includeSystem: whether to include system tiddlers (defaults to false)
*/
exports.forEachTiddler = function(/* [options,]callback */) {
	var arg = 0,
		options = arguments.length >= 2 ? arguments[arg++] : {},
		callback = arguments[arg++],
		titles = this.getTiddlers(options),
		t, tiddler;
	for(t=0; t<titles.length; t++) {
		tiddler = this.getTiddler(titles[t]);
		if(tiddler) {
			callback.call(this,tiddler.fields.title,tiddler);
		}
	}
};

/*
Return an array of tiddler titles that are directly linked from the specified tiddler
*/
exports.getTiddlerLinks = function(title) {
	var self = this;
	// We'll cache the links so they only get computed if the tiddler changes
	return this.getCacheForTiddler(title,"links",function() {
		// Parse the tiddler
		var parser = self.parseTiddler(title);
		// Count up the links
		var links = [],
			checkParseTree = function(parseTree) {
				for(var t=0; t<parseTree.length; t++) {
					var parseTreeNode = parseTree[t];
					if(parseTreeNode.type === "link" && parseTreeNode.attributes.to && parseTreeNode.attributes.to.type === "string") {
						var value = parseTreeNode.attributes.to.value;
						if(links.indexOf(value) === -1) {
							links.push(value);
						}
					}
					if(parseTreeNode.children) {
						checkParseTree(parseTreeNode.children);
					}
				}
			};
		if(parser) {
			checkParseTree(parser.tree);
		}
		return links;
	});
};

/*
Return an array of tiddler titles that link to the specified tiddler
*/
exports.getTiddlerBacklinks = function(targetTitle) {
	var self = this,
		backlinks = [];
	this.forEachTiddler(function(title,tiddler) {
		var links = self.getTiddlerLinks(title);
		if(links.indexOf(targetTitle) !== -1) {
			backlinks.push(title);
		}
	});
	return backlinks;
};

/*
Return a hashmap of tiddler titles that are referenced but not defined. Each value is the number of times the missing tiddler is referenced
*/
exports.getMissingTitles = function() {
	var self = this,
		missing = [];
// We should cache the missing tiddler list, even if we recreate it every time any tiddler is modified
	this.forEachTiddler(function(title,tiddler) {
		var links = self.getTiddlerLinks(title);
		$tw.utils.each(links,function(link) {
			if((!self.tiddlerExists(link) && !self.isShadowTiddler(link)) && missing.indexOf(link) === -1) {
				missing.push(link);
			}
		});
	});
	return missing;
};

exports.getOrphanTitles = function() {
	var self = this,
		orphans = this.getTiddlers();
	this.forEachTiddler(function(title,tiddler) {
		var links = self.getTiddlerLinks(title);
		$tw.utils.each(links,function(link) {
			var p = orphans.indexOf(link);
			if(p !== -1) {
				orphans.splice(p,1);
			}
		});
	});
	return orphans; // Todo
};

/*
Retrieves a list of the tiddler titles that are tagged with a given tag
*/
exports.getTiddlersWithTag = function(tag) {
	var self = this;
	return this.getGlobalCache("taglist-" + tag,function() {
		var tagmap = self.getTagMap();
		return self.sortByList(tagmap[tag],tag);
	});
};

/*
Get a hashmap by tag of arrays of tiddler titles
*/
exports.getTagMap = function() {
	var self = this;
	return this.getGlobalCache("tagmap",function() {
		var tags = Object.create(null),
			storeTags = function(tagArray,title) {
				if(tagArray) {
					for(var index=0; index<tagArray.length; index++) {
						var tag = tagArray[index];
						if($tw.utils.hop(tags,tag)) {
							tags[tag].push(title);
						} else {
							tags[tag] = [title];
						}
					}
				}
			},
			title, tiddler;
		// Collect up all the tags
		self.eachShadow(function(tiddler,title) {
			if(!self.tiddlerExists(title)) {
				tiddler = self.getTiddler(title);
				storeTags(tiddler.fields.tags,title);
			}
		});
		self.each(function(tiddler,title) {
			storeTags(tiddler.fields.tags,title);
		});
		return tags;
	});
};

/*
Lookup a given tiddler and return a list of all the tiddlers that include it in the specified list field
*/
exports.findListingsOfTiddler = function(targetTitle,fieldName) {
	fieldName = fieldName || "list";
	var titles = [];
	this.each(function(tiddler,title) {
		var list = $tw.utils.parseStringArray(tiddler.fields[fieldName]);
		if(list && list.indexOf(targetTitle) !== -1) {
			titles.push(title);
		}
	});
	return titles;
};

/*
Sorts an array of tiddler titles according to an ordered list
*/
exports.sortByList = function(array,listTitle) {
	var list = this.getTiddlerList(listTitle);
	if(!array || array.length === 0) {
		return [];
	} else {
		var titles = [], t, title;
		// First place any entries that are present in the list
		for(t=0; t<list.length; t++) {
			title = list[t];
			if(array.indexOf(title) !== -1) {
				titles.push(title);
			}
		}
		// Then place any remaining entries
		for(t=0; t<array.length; t++) {
			title = array[t];
			if(list.indexOf(title) === -1) {
				titles.push(title);
			}
		}
		// Finally obey the list-before and list-after fields of each tiddler in turn
		var sortedTitles = titles.slice(0);
		for(t=0; t<sortedTitles.length; t++) {
			title = sortedTitles[t];
			var currPos = titles.indexOf(title),
				newPos = -1,
				tiddler = this.getTiddler(title);
			if(tiddler) {
				var beforeTitle = tiddler.fields["list-before"],
					afterTitle = tiddler.fields["list-after"];
				if(beforeTitle === "") {
					newPos = 0;
				} else if(beforeTitle) {
					newPos = titles.indexOf(beforeTitle);
				} else if(afterTitle) {
					newPos = titles.indexOf(afterTitle);
					if(newPos >= 0) {
						++newPos;
					}
				}
				if(newPos === -1) {
					newPos = currPos;
				}
				if(newPos !== currPos) {
					titles.splice(currPos,1);
					if(newPos >= currPos) {
						newPos--;
					}
					titles.splice(newPos,0,title);
				}
			}

		}
		return titles;
	}
};

exports.getSubTiddler = function(title,subTiddlerTitle) {
	var bundleInfo = this.getPluginInfo(title) || this.getTiddlerData(title);
	if(bundleInfo && bundleInfo.tiddlers) {
		var subTiddler = bundleInfo.tiddlers[subTiddlerTitle];
		if(subTiddler) {
			return new $tw.Tiddler(subTiddler);
		}
	}
	return null;
};

/*
Retrieve a tiddler as a JSON string of the fields
*/
exports.getTiddlerAsJson = function(title) {
	var tiddler = this.getTiddler(title);
	if(tiddler) {
		var fields = Object.create(null);
		$tw.utils.each(tiddler.fields,function(value,name) {
			fields[name] = tiddler.getFieldString(name);
		});
		return JSON.stringify(fields);
	} else {
		return JSON.stringify({title: title});
	}
};

/*
Get the content of a tiddler as a JavaScript object. How this is done depends on the type of the tiddler:

application/json: the tiddler JSON is parsed into an object
application/x-tiddler-dictionary: the tiddler is parsed as sequence of name:value pairs

Other types currently just return null.

titleOrTiddler: string tiddler title or a tiddler object
defaultData: default data to be returned if the tiddler is missing or doesn't contain data
*/
exports.getTiddlerData = function(titleOrTiddler,defaultData) {
	var tiddler = titleOrTiddler,
		data;
	if(!(tiddler instanceof $tw.Tiddler)) {
		tiddler = this.getTiddler(tiddler);	
	}
	if(tiddler && tiddler.fields.text) {
		switch(tiddler.fields.type) {
			case "application/json":
				// JSON tiddler
				try {
					data = JSON.parse(tiddler.fields.text);
				} catch(ex) {
					return defaultData;
				}
				return data;
			case "application/x-tiddler-dictionary":
				return $tw.utils.parseFields(tiddler.fields.text);
		}
	}
	return defaultData;
};

/*
Extract an indexed field from within a data tiddler
*/
exports.extractTiddlerDataItem = function(titleOrTiddler,index,defaultText) {
	var data = this.getTiddlerData(titleOrTiddler,Object.create(null)),
		text;
	if(data && $tw.utils.hop(data,index)) {
		text = data[index];
	}
	if(typeof text === "string" || typeof text === "number") {
		return text.toString();
	} else {
		return defaultText;
	}
};

/*
Set a tiddlers content to a JavaScript object. Currently this is done by setting the tiddler's type to "application/json" and setting the text to the JSON text of the data.
title: title of tiddler
data: object that can be serialised to JSON
fields: optional hashmap of additional tiddler fields to be set
*/
exports.setTiddlerData = function(title,data,fields) {
	var existingTiddler = this.getTiddler(title),
		newFields = {
			title: title
	};
	if(existingTiddler && existingTiddler.fields.type === "application/x-tiddler-dictionary") {
		newFields.text = $tw.utils.makeTiddlerDictionary(data);
	} else {
		newFields.type = "application/json";
		newFields.text = JSON.stringify(data,null,$tw.config.preferences.jsonSpaces);
	}
	this.addTiddler(new $tw.Tiddler(this.getCreationFields(),existingTiddler,fields,newFields,this.getModificationFields()));
};

/*
Return the content of a tiddler as an array containing each line
*/
exports.getTiddlerList = function(title,field,index) {
	if(index) {
		return $tw.utils.parseStringArray(this.extractTiddlerDataItem(title,index,""));
	}
	field = field || "list";
	var tiddler = this.getTiddler(title);
	if(tiddler) {
		return ($tw.utils.parseStringArray(tiddler.fields[field]) || []).slice(0);
	}
	return [];
};

// Return a named global cache object. Global cache objects are cleared whenever a tiddler change occurs
exports.getGlobalCache = function(cacheName,initializer) {
	this.globalCache = this.globalCache || Object.create(null);
	if($tw.utils.hop(this.globalCache,cacheName)) {
		return this.globalCache[cacheName];
	} else {
		this.globalCache[cacheName] = initializer();
		return this.globalCache[cacheName];
	}
};

exports.clearGlobalCache = function() {
	this.globalCache = Object.create(null);
};

// Return the named cache object for a tiddler. If the cache doesn't exist then the initializer function is invoked to create it
exports.getCacheForTiddler = function(title,cacheName,initializer) {
	this.caches = this.caches || Object.create(null);
	var caches = this.caches[title];
	if(caches && caches[cacheName]) {
		return caches[cacheName];
	} else {
		if(!caches) {
			caches = Object.create(null);
			this.caches[title] = caches;
		}
		caches[cacheName] = initializer();
		return caches[cacheName];
	}
};

// Clear all caches associated with a particular tiddler
exports.clearCache = function(title) {
	this.caches = this.caches || Object.create(null);
	if($tw.utils.hop(this.caches,title)) {
		delete this.caches[title];
	}
};

exports.initParsers = function(moduleType) {
	// Install the parser modules
	$tw.Wiki.parsers = {};
	var self = this;
	$tw.modules.forEachModuleOfType("parser",function(title,module) {
		for(var f in module) {
			if($tw.utils.hop(module,f)) {
				$tw.Wiki.parsers[f] = module[f]; // Store the parser class
			}
		}
	});
};

/*
Parse a block of text of a specified MIME type
	type: content type of text to be parsed
	text: text
	options: see below
Options include:
	parseAsInline: if true, the text of the tiddler will be parsed as an inline run
	_canonical_uri: optional string of the canonical URI of this content
*/
exports.parseText = function(type,text,options) {
	options = options || {};
	// Select a parser
	var Parser = $tw.Wiki.parsers[type];
	if(!Parser && $tw.utils.getFileExtensionInfo(type)) {
		Parser = $tw.Wiki.parsers[$tw.utils.getFileExtensionInfo(type).type];
	}
	if(!Parser) {
		Parser = $tw.Wiki.parsers[options.defaultType || "text/vnd.tiddlywiki"];
	}
	if(!Parser) {
		return null;
	}
	// Return the parser instance
	return new Parser(type,text,{
		parseAsInline: options.parseAsInline,
		wiki: this,
		_canonical_uri: options._canonical_uri
	});
};

/*
Parse a tiddler according to its MIME type
*/
exports.parseTiddler = function(title,options) {
	options = $tw.utils.extend({},options);
	var cacheType = options.parseAsInline ? "newInlineParseTree" : "newBlockParseTree",
		tiddler = this.getTiddler(title),
		self = this;
	return tiddler ? this.getCacheForTiddler(title,cacheType,function() {
			if(tiddler.hasField("_canonical_uri")) {
				options._canonical_uri = tiddler.fields._canonical_uri;
			}
			return self.parseText(tiddler.fields.type,tiddler.fields.text,options);
		}) : null;
};

exports.parseTextReference = function(title,field,index,options) {
	var tiddler,text;
	if(options.subTiddler) {
		tiddler = this.getSubTiddler(title,options.subTiddler);
	} else {
		tiddler = this.getTiddler(title);
		if(field === "text" || (!field && !index)) {
			this.getTiddlerText(title); // Force the tiddler to be lazily loaded
			return this.parseTiddler(title,options);
		}
	}
	if(field === "text" || (!field && !index)) {
		if(tiddler && tiddler.fields) {
			return this.parseText(tiddler.fields.type || "text/vnd.tiddlywiki",tiddler.fields.text,options);			
		} else {
			return null;
		}
	} else if(field) {
		if(field === "title") {
			text = title;
		} else {
			if(!tiddler || !tiddler.hasField(field)) {
				return null;
			}
			text = tiddler.fields[field];
		}
		return this.parseText("text/vnd.tiddlywiki",text.toString(),options);
	} else if(index) {
		this.getTiddlerText(title); // Force the tiddler to be lazily loaded
		text = this.extractTiddlerDataItem(tiddler,index,undefined);
		if(text === undefined) {
			return null;
		}
		return this.parseText("text/vnd.tiddlywiki",text,options);
	}
};

/*
Make a widget tree for a parse tree
parser: parser object
options: see below
Options include:
document: optional document to use
variables: hashmap of variables to set
parentWidget: optional parent widget for the root node
*/
exports.makeWidget = function(parser,options) {
	options = options || {};
	var widgetNode = {
			type: "widget",
			children: []
		},
		currWidgetNode = widgetNode;
	// Create set variable widgets for each variable
	$tw.utils.each(options.variables,function(value,name) {
		var setVariableWidget = {
			type: "set",
			attributes: {
				name: {type: "string", value: name},
				value: {type: "string", value: value}
			},
			children: []
		};
		currWidgetNode.children = [setVariableWidget];
		currWidgetNode = setVariableWidget;
	});
	// Add in the supplied parse tree nodes
	currWidgetNode.children = parser ? parser.tree : [];
	// Create the widget
	return new widget.widget(widgetNode,{
		wiki: this,
		document: options.document || $tw.fakeDocument,
		parentWidget: options.parentWidget
	});
};

/*
Make a widget tree for transclusion
title: target tiddler title
options: as for wiki.makeWidget() plus:
options.field: optional field to transclude (defaults to "text")
options.mode: transclusion mode "inline" or "block"
options.children: optional array of children for the transclude widget
*/
exports.makeTranscludeWidget = function(title,options) {
	options = options || {};
	var parseTree = {tree: [{
			type: "element",
			tag: "div",
			children: [{
				type: "transclude",
				attributes: {
					tiddler: {
						name: "tiddler",
						type: "string",
						value: title}},
				isBlock: !options.parseAsInline}]}
	]};
	if(options.field) {
		parseTree.tree[0].children[0].attributes.field = {type: "string", value: options.field};
	}
	if(options.mode) {
		parseTree.tree[0].children[0].attributes.mode = {type: "string", value: options.mode};
	}
	if(options.children) {
		parseTree.tree[0].children[0].children = options.children;
	}
	return $tw.wiki.makeWidget(parseTree,options);
};

/*
Parse text in a specified format and render it into another format
	outputType: content type for the output
	textType: content type of the input text
	text: input text
	options: see below
Options include:
variables: hashmap of variables to set
parentWidget: optional parent widget for the root node
*/
exports.renderText = function(outputType,textType,text,options) {
	options = options || {};
	var parser = this.parseText(textType,text,options),
		widgetNode = this.makeWidget(parser,options);
	var container = $tw.fakeDocument.createElement("div");
	widgetNode.render(container,null);
	return outputType === "text/html" ? container.innerHTML : container.textContent;
};

/*
Parse text from a tiddler and render it into another format
	outputType: content type for the output
	title: title of the tiddler to be rendered
	options: see below
Options include:
variables: hashmap of variables to set
parentWidget: optional parent widget for the root node
*/
exports.renderTiddler = function(outputType,title,options) {
	options = options || {};
	var parser = this.parseTiddler(title,options),
		widgetNode = this.makeWidget(parser,options);
	var container = $tw.fakeDocument.createElement("div");
	widgetNode.render(container,null);
	return outputType === "text/html" ? container.innerHTML : (outputType === "text/plain-formatted" ? container.formattedTextContent : container.textContent);
};

/*
Return an array of tiddler titles that match a search string
	text: The text string to search for
	options: see below
Options available:
	source: an iterator function for the source tiddlers, called source(iterator), where iterator is called as iterator(tiddler,title)
	exclude: An array of tiddler titles to exclude from the search
	invert: If true returns tiddlers that do not contain the specified string
	caseSensitive: If true forces a case sensitive search
	literal: If true, searches for literal string, rather than separate search terms
	field: If specified, restricts the search to the specified field
*/
exports.search = function(text,options) {
	options = options || {};
	var self = this,
		t,
		invert = !!options.invert;
	// Convert the search string into a regexp for each term
	var terms, searchTermsRegExps,
		flags = options.caseSensitive ? "" : "i";
	if(options.literal) {
		if(text.length === 0) {
			searchTermsRegExps = null;
		} else {
			searchTermsRegExps = [new RegExp("(" + $tw.utils.escapeRegExp(text) + ")",flags)];
		}
	} else {
		terms = text.split(/ +/);
		if(terms.length === 1 && terms[0] === "") {
			searchTermsRegExps = null;
		} else {
			searchTermsRegExps = [];
			for(t=0; t<terms.length; t++) {
				searchTermsRegExps.push(new RegExp("(" + $tw.utils.escapeRegExp(terms[t]) + ")",flags));
			}
		}
	}
	// Function to check a given tiddler for the search term
	var searchTiddler = function(title) {
		if(!searchTermsRegExps) {
			return true;
		}
		var tiddler = self.getTiddler(title);
		if(!tiddler) {
			tiddler = new $tw.Tiddler({title: title, text: "", type: "text/vnd.tiddlywiki"});
		}
		var contentTypeInfo = $tw.config.contentTypeInfo[tiddler.fields.type] || $tw.config.contentTypeInfo["text/vnd.tiddlywiki"],
			match;
		for(var t=0; t<searchTermsRegExps.length; t++) {
			match = false;
			if(options.field) {
				match = searchTermsRegExps[t].test(tiddler.getFieldString(options.field));
			} else {
				// Search title, tags and body
				if(contentTypeInfo.encoding === "utf8") {
					match = match || searchTermsRegExps[t].test(tiddler.fields.text);
				}
				var tags = tiddler.fields.tags ? tiddler.fields.tags.join("\0") : "";
				match = match || searchTermsRegExps[t].test(tags) || searchTermsRegExps[t].test(tiddler.fields.title);
			}
			if(!match) {
				return false;
			}
		}
		return true;
	};
	// Loop through all the tiddlers doing the search
	var results = [],
		source = options.source || this.each;
	source(function(tiddler,title) {
		if(searchTiddler(title) !== options.invert) {
			results.push(title);
		}
	});
	// Remove any of the results we have to exclude
	if(options.exclude) {
		for(t=0; t<options.exclude.length; t++) {
			var p = results.indexOf(options.exclude[t]);
			if(p !== -1) {
				results.splice(p,1);
			}
		}
	}
	return results;
};

/*
Trigger a load for a tiddler if it is skinny. Returns the text, or undefined if the tiddler is missing, null if the tiddler is being lazily loaded.
*/
exports.getTiddlerText = function(title,defaultText) {
	var tiddler = this.getTiddler(title);
	// Return undefined if the tiddler isn't found
	if(!tiddler) {
		return defaultText;
	}
	if(tiddler.fields.text !== undefined) {
		// Just return the text if we've got it
		return tiddler.fields.text;
	} else {
		// Tell any listeners about the need to lazily load this tiddler
		this.dispatchEvent("lazyLoad",title);
		// Indicate that the text is being loaded
		return null;
	}
};

/*
Read an array of browser File objects, invoking callback(tiddlerFieldsArray) once they're all read
*/
exports.readFiles = function(files,callback) {
	var result = [],
		outstanding = files.length;
	for(var f=0; f<files.length; f++) {
		this.readFile(files[f],function(tiddlerFieldsArray) {
			result.push.apply(result,tiddlerFieldsArray);
			if(--outstanding === 0) {
				callback(result);
			}
		});
	}
	return files.length;
};

/*
Read a browser File object, invoking callback(tiddlerFieldsArray) with an array of tiddler fields objects
*/
exports.readFile = function(file,callback) {
	// Get the type, falling back to the filename extension
	var self = this,
		type = file.type;
	if(type === "" || !type) {
		var dotPos = file.name.lastIndexOf(".");
		if(dotPos !== -1) {
			var fileExtensionInfo = $tw.utils.getFileExtensionInfo(file.name.substr(dotPos));
			if(fileExtensionInfo) {
				type = fileExtensionInfo.type;
			}
		}
	}
	// Figure out if we're reading a binary file
	var contentTypeInfo = $tw.config.contentTypeInfo[type],
		isBinary = contentTypeInfo ? contentTypeInfo.encoding === "base64" : false;
	// Log some debugging information
	if($tw.log.IMPORT) {
		console.log("Importing file '" + file.name + "', type: '" + type + "', isBinary: " + isBinary);
	}
	// Create the FileReader
	var reader = new FileReader();
	// Onload
	reader.onload = function(event) {
		// Deserialise the file contents
		var text = event.target.result,
			tiddlerFields = {title: file.name || "Untitled", type: type};
		// Are we binary?
		if(isBinary) {
			// The base64 section starts after the first comma in the data URI
			var commaPos = text.indexOf(",");
			if(commaPos !== -1) {
				tiddlerFields.text = text.substr(commaPos+1);
				callback([tiddlerFields]);
			}
		} else {
			// Check whether this is an encrypted TiddlyWiki file
			var encryptedJson = $tw.utils.extractEncryptedStoreArea(text);
			if(encryptedJson) {
				// If so, attempt to decrypt it with the current password
				$tw.utils.decryptStoreAreaInteractive(encryptedJson,function(tiddlers) {
					callback(tiddlers);
				});
			} else {
				// Otherwise, just try to deserialise any tiddlers in the file
				callback(self.deserializeTiddlers(type,text,tiddlerFields));
			}
		}
	};
	// Kick off the read
	if(isBinary) {
		reader.readAsDataURL(file);
	} else {
		reader.readAsText(file);
	}
};

/*
Find any existing draft of a specified tiddler
*/
exports.findDraft = function(targetTitle) {
	var draftTitle = undefined;
	this.forEachTiddler({includeSystem: true},function(title,tiddler) {
		if(tiddler.fields["draft.title"] && tiddler.fields["draft.of"] === targetTitle) {
			draftTitle = title;
		}
	});
	return draftTitle;
}

/*
Check whether the specified draft tiddler has been modified
*/
exports.isDraftModified = function(title) {
	var tiddler = this.getTiddler(title);
	if(!tiddler.isDraft()) {
		return false;
	}
	var ignoredFields = ["created", "modified", "title", "draft.title", "draft.of"],
		origTiddler = this.getTiddler(tiddler.fields["draft.of"]);
	if(!origTiddler) {
		return tiddler.fields.text !== "";
	}
	return tiddler.fields["draft.title"] !== tiddler.fields["draft.of"] || !tiddler.isEqual(origTiddler,ignoredFields);
};

/*
Add a new record to the top of the history stack
title: a title string or an array of title strings
fromPageRect: page coordinates of the origin of the navigation
historyTitle: title of history tiddler (defaults to $:/HistoryList)
*/
exports.addToHistory = function(title,fromPageRect,historyTitle) {
	historyTitle = historyTitle || "$:/HistoryList";
	var titles = $tw.utils.isArray(title) ? title : [title];
	// Add a new record to the top of the history stack
	var historyList = this.getTiddlerData(historyTitle,[]);
	$tw.utils.each(titles,function(title) {
		historyList.push({title: title, fromPageRect: fromPageRect});
	});
	this.setTiddlerData(historyTitle,historyList,{"current-tiddler": titles[titles.length-1]});
};

/*
Invoke the available upgrader modules
titles: array of tiddler titles to be processed
tiddlers: hashmap by title of tiddler fields of pending import tiddlers. These can be modified by the upgraders. An entry with no fields indicates a tiddler that was pending import has been suppressed. When entries are added to the pending import the tiddlers hashmap may have entries that are not present in the titles array
Returns a hashmap of messages keyed by tiddler title.
*/
exports.invokeUpgraders = function(titles,tiddlers) {
	// Collect up the available upgrader modules
	var self = this;
	if(!this.upgraderModules) {
		this.upgraderModules = [];
		$tw.modules.forEachModuleOfType("upgrader",function(title,module) {
			if(module.upgrade) {
				self.upgraderModules.push(module);
			}
		});
	}
	// Invoke each upgrader in turn
	var messages = {};
	for(var t=0; t<this.upgraderModules.length; t++) {
		var upgrader = this.upgraderModules[t],
			upgraderMessages = upgrader.upgrade(this,titles,tiddlers);
		$tw.utils.extend(messages,upgraderMessages);
	}
	return messages;
};

})();
