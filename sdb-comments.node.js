var
	_ 			= require('lodash'),
	colDefaults = {
		username		: 'username',
		commentBody	: 'commentBody',
		ts					: 'ts',
		slug				: 'slug',
		thumb				: 'thumb',
		displayName	: 'displayName'
	},
	limitDefault  = false,
	middlewareDestPath
								= 'sdbComments',
	defaultTimeFormat
								= 'YYYY-MM-DD HH24:MI';
								
require('date-utils');

function attributeObjectify(attributes) {
  return _.reduce(
    attributes,
    function(allAttrs, anAttr) {
      allAttrs[anAttr.Name] = anAttr.Value;
      
      return allAttrs;
    },
    {}
  );
}


/**
 * returns an attribute object
 * 
 * @param {string} colName - The name of the simpleDB column
 * @param {object} anObj - The object to get the colName from
 */
function getFromObj(colName,anObj) {
	return {
		Name 	: colName, 	Value 	: anObj[colName]
	};
}
function objectNeedsKeys(anObj, keys) {
	var
		objHasKeys;
	objHasKeys = _(keys)
		.map(function(aRequiredProperty) {
			return _.has(anObj,aRequiredProperty);
		})
		.value();
	return _.every(objHasKeys);
}

function makeItemName(aCommentObj) {
	return [
		aCommentObj.slug,
		aCommentObj.ts
	].join(':');
}

function submitComment(col,tableDomain,simpledb) {
	return function(commentObj,cb) {
		var
			attrs,
			required = [col.username, col.commentBody, col.slug];
		
		commentObj.ts = String(new Date().getTime());
		
		if (!objectNeedsKeys(commentObj,required)) {
			console.log();
			cb(new Error(
				'Missing required comment properties: '+required.join()
				)
			);
		} else {
			attrs = [
				getFromObj(col.username, commentObj),
				getFromObj(col.ts, commentObj),
				getFromObj(col.commentBody, commentObj),
				getFromObj(col.slug, commentObj)
			];
			
			if (commentObj[col.displayName]) {
				attrs.push(
					getFromObj(col.displayName, commentObj)
				);
			}
			
			if (commentObj[col.thumb]) {
				attrs.push(
					getFromObj(col.thumb, commentObj)
				);
			}
			
			simpledb.putAttributes({
				Attributes	: attrs,
				DomainName	: tableDomain,
				ItemName		: makeItemName(commentObj)
			},cb);
		}
	}
}
function getThread(col,tableDomain,timeFormat, limit, simpledb) {
	return function(threadObj, cb) {
		var
			queryArr = [
				'select  *  from `',
				tableDomain,
				'` where ',
				col.slug,
				' = \'',
				threadObj[col.slug],
				'\' and ts is not null order by ts desc'
			],
			query,
			selectObj;
		
		if (limit) {
			queryArr.push(' LIMIT '+limit);
		}
		
		query = queryArr.join('');
		
		if (threadObj.consistent) {
			selectObj.ConsistentRead = threadObj.consistent;
		}
		if (threadObj.next) {
			selectObj.NextToken = threadObj.next;
		}
		
		
		selectObj = { SelectExpression 	: query };
		
		simpledb.select(
			selectObj,
			function(err, awsRes){
				var
					comments,
					outObj;
					
				if (err) {
					cb(err);
				} else {

					comments = _(awsRes.Items)
						.map(function(anItem) {
							return attributeObjectify(anItem.Attributes);
						})
						.map(function(anItem) {
							anItem.ts = Number(anItem.ts);
							anItem.timeOfPost = new Date(anItem.ts).toFormat(timeFormat);
							return anItem;
						})
						.value();
					
					outObj = {
						comments : comments
					};
					
					if (awsRes.NextToken) {
						outObj.next = awsRes.NextToken;
					}
					
					cb(err, outObj);
				}
			}
		);
	};
}

function submitMiddleware(col, thisSubmit, commentPath) {
	return function(threadPath, userPaths) {
		return function(req,res,next) {
			var
				submitObj = {};
			
			//required
			submitObj[col.slug] = _.get(req,threadPath), //from the body object
			submitObj[col.username] = _.get(req,userPaths[col.username]) //from authentication
			
			//optional from authentication
			if (userPaths[col.thumb]) {
				submitObj[col.thumb] = _.get(req, userPaths[col.thumb]);
			}
			if (userPaths[col.displayName]) {
				submitObj[col.displayName] = _.get(req, userPaths[col.displayName]);
			}

			submitObj[col.commentBody] = _.get(req.body, col.commentBody);

			thisSubmit(
				submitObj,
				function(err, results) {
					if (err) { next(err); } else {
						_.set(req, commentPath, { status : 'OK' });
						next();
					}	
				}
			);
		};
	};
}
function threadMiddleware(col, thisThread, commentPath) {
	//return inception
	return function(threadPath,nextParamPath) {
		return function(req,res,next) {
			var
				threadObj = {},
				nextParam;
			
			threadObj[col.slug] = _.get(req,threadPath);
			if ((nextParamPath) && (_.get(req,nextParamPath))) {
				threadObj['next'] = _.get(req,nextParamPath);
			}
			
			thisThread(
				threadObj,
				function(err,thread) {
				if (err) { next(err); } else {
					_.set(req,commentPath,thread);
					next();
				}
			});
		};
	};
}

function comments(setupObj){
	var
		required = ['simpledb','tableDomain'],
		requiredCheck,
		col,
		limit,
		tableDomain,
		consistentRead,
		simpledb,
		timeFormat,
		thisSubmit,
		thisThread,
		commentPath,
		resPath;

	
	//check for required object properties
	if (!objectNeedsKeys(setupObj,required)) {
		throw new Error(
			'simpledb comments setup is missing required property. The following properites are required: '+required.join()
		);
	} else {
		col = _.assign(colDefaults, setupObj.columns);
		tableDomain = setupObj.tableDomain;
		simpledb = setupObj.simpledb;
		timeFormat = setupObj.timeFormat ? setupObj.timeFormat : defaultTimeFormat;
		commentPath = setupObj.commentPath ? setupObj.commentPath : middlewareDestPath;
	}
	
	limit = setupObj.limit ? setupObj.limit : limitDefault;
	
	thisSubmit = submitComment(col,tableDomain,simpledb);
	thisThread = getThread(col,tableDomain,timeFormat,limit,simpledb);
	
	
	
	return {
		submit		: thisSubmit,
		thread		: thisThread,
		middleware: {
			thread : threadMiddleware(col,thisThread,commentPath),
			submit : submitMiddleware(col,thisSubmit,commentPath)
		}
	}
}

module.exports = comments;