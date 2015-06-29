#simpledb-comments

User comments are a drag - so is maintaining a database to hold them. Simpledb-comments allows you to integrate a comments engine that stores data on [AWS SimpleDB](http://aws.amazon.com/simpledb/). It's also not picky about what you use to authenticate users and can be implemented through [Express](http://expressjs.com/) middlewares.

##Simple Example - Submitting a Comment
```
var
  aws                = require('aws-sdk'),
  simpleDbComments   = require('simpledb-comments'),
  comments,
  simpledb;

//setup aws
aws.config.apiVersions = {
  simpledb: '2009-04-15'
};
aws.config.loadFromPath(/* load your credentials */);
simpledb = new aws.SimpleDB({
  region     : 'US-East',
  endpoint   : 'https://sdb.amazonaws.com'
});

//define your configuration
comments = simpleDbComments({
  //pass in your simpledb aws object
  simpledb     : simpledb,
  //tell it what table domain to look in
  tableDomain  : 'comments-sample'
});

//submit a comment
comments.submit({
  username    : 'john-doe',
  commentBody : 'lorem ipsum',
  slug        : 'testItem' , //the slug that identifies your thread
},function(err,results){
  if (err) { throw(err); } else {
    console.log(results);
  }
});
```

##Simple Example - Getting Comments

Do the above configuration and replace `comments.submit` with this:

```
comments.thread({
  slug   : 'testItem',
},function(err,results){
  if (err) { throw(err); } else {
    console.log(results);
  }
});
```

##Example Express server with comments

This is an example implementation of simpledb-comments in an express server. _Note:_ This has no authentication and is thus not something you should throw on a production server, you'll want to tie in whatever type of authentication you're using in your project and pass the username through to simpledb-comments.

```
var
  aws                = require('aws-sdk'),
  simpleDbComments   = require('simpledb-comments'),
  express            = require('express'),
  bodyParser        = require('body-parser'),
  app               = express(),
  threadPath,
  comments,
  simpledb;

aws.config.apiVersions = {
  simpledb: '2009-04-15'
};
aws.config.loadFromPath(/* load your credentials */);
simpledb = new aws.SimpleDB({
  region     : 'US-East',
  endpoint   : 'https://sdb.amazonaws.com'
});

comments = simpleDbComments({
  //this is your configuration object
  simpledb     : simpledb,
  tableDomain  : 'comments-sample'
});

//you need some sort of body parser to get the POST data
app.use(
  bodyParser.urlencoded({
    extended  : true
  })
);


threadPath = 'params.thread'; //the module will look for your thread slug at req.params.thread in this case
app.get(
  '/thread/:thread(\\w+)/:next?', //regexp on the thread param for extra security since this is quoted into the query string.
  //`next` represents the next token if you placed a limit on the number displayed in your original configuration
  comments.middleware.thread(threadPath),
  function(req,res) {
    res.send(req.sdbComments); //by default, the results are placed in req.sdbComments, but you can change this by defining 'commentPath' in your configuration object
  }
);

app.post(
  '/thread/:thread(\\w+)/:username', //your username should come from your authentication/session management system, not from the path. This is just for demonstration.
  comments.middleware.submit(
    threadPath,
    {
        username    : 'params.username', //you can point these object paths to anywhere in the express req
        commentBody  : 'body.commentBody'
    }
  ),
  function(req,res) {
    res.send(req.sdbComments);
  }
)

app.listen(3000);
```

In this example, you can point your browser to http://localhost:3000/thread/your-thread to view the thread as JSON. To post a comment POST to http://localhost:3000/thread/your-thread/your-username to submit a comment. In CURL it would look like: `curl --data "commentBody=test1234567" http://localhost:3000/thread/testItem/john`

To implement a JSON/AJAX based comment system, just expand on the above code and integrate it with the rest of your app. You can also use it as a middleware and then pass it along to a template engine. Be warned, SimpleDB is a slow link and it could make your pages rather slow.