'use strict';

var argv = require('yargs').argv;
var extend = require('node.extend');
var es = require('event-stream');
var path = require('path');
var through = require('through2');
var vinylSourceStream = require('vinyl-source-stream');

// we later iterate through this plugin object, plugin lazy loading has to be disabled
var $ = require('gulp-load-plugins')({
  config: require.resolve('./package.json'),
  lazy: false
});

var defaultConfig = require('./config');
var testRunner = require('./test-runner');

module.exports = function(gulp, userConfig) {
  var config = extend(true, {}, defaultConfig, userConfig);
  var env = argv.type || 'development';

  var lrServer;
  var cleanFolders = {};

  var getFolders = function(base, folders) {
    return gulp.src(folders.map(function(item) {
      return path.join(base, item);
    }), { base: base });
  };

  var isPluginEnabled = function(name) {
    return config[name] && config[name].enabled;
  };

  var browserify = isPluginEnabled('watch') ? require('watchify') : require('browserify');
  var bundler = browserify('./' + path.join(config.src.scriptDir, config.src.scriptMain));
  for (var t in config.browserify.transforms) {
    if (config.browserify.transforms.hasOwnProperty(t) && config.browserify.transforms[t]) {
      bundler.transform(t);
    }
  }

  // disabled gulp plugins are replaced with stream that passes everything through
  for (var p in $) {
    if ($.hasOwnProperty(p)) {
      if (!isPluginEnabled(p))
        $[p] = through.obj;
    }
  }

  // every task calls cb to measure its execution time
  gulp.task('lrServer', function(cb) {
    lrServer = $.livereload();
    cb();
  });
  gulp.task('scripts', function(cb) {
    if (cleanFolders['scripts']) { return cb(); }

    cleanFolders['scripts'] = true;
    gulp.src(path.join(config.dist.scriptDir, config.dist.scriptFiles), { read: false })
      .pipe($.clean())
      .on('end', function() {
        bundler.bundle(config.browserify)
          .on('error', function (err) {
            if (isPluginEnabled('plumber')) {
              config.plumber.errorHandler(err, 'browserify');
              cb();
            }
            else
              throw err;
          })
          .pipe(vinylSourceStream(config.src.scriptMain))
          .pipe($.plumber(config.plumber))
          .pipe($.rename(config.rename))
          .pipe(gulp.dest(config.dist.scriptDir))
          .on('end', cb);
      });
  });

  gulp.task('styles', function(cb) {
    if (cleanFolders['styles']) { return cb(); }

    cleanFolders['styles'] = true;

    gulp.src(path.join(config.dist.styleDir, config.dist.styleFiles), { read: false })
      .pipe($.clean())
      .on('end', function() {
        gulp.src(path.join(config.src.styleDir, config.src.styleMain))
          .pipe($.plumber(config.plumber))
          .pipe($.less(config.less))
          .pipe($.rename(config.rename))
          .pipe(gulp.dest(config.dist.styleDir))
          .on('end', cb);
      });
  });

  gulp.task('index', ['scripts', 'styles', 'images'], function(cb) {
    var markupStream = gulp.src(path.join(config.src.markupDir, config.src.markupFiles))
      .pipe($.plumber(config.plumber));
    if (!isPluginEnabled('rename'))
      markupStream = markupStream.pipe($.newer(config.dist.markupDir));

    markupStream = markupStream
      .pipe($.inject(gulp.src([
        path.join(config.dist.scriptDir, config.dist.scriptFiles),
        path.join(config.dist.styleDir, config.dist.styleFiles)
      ], { read: false }), config.inject))
      .pipe($.htmlmin(config.htmlmin));

    var streams = [markupStream];
    if (config.copy.length)
      streams.push(getFolders('src', config.copy));

    es.merge.apply(null, streams)
      .pipe(gulp.dest('dist'))
      .on('end', cb);
  });

  gulp.task('images', function(cb) {
    gulp.src(path.join(config.src.imageDir, config.src.imageFiles))
      .pipe($.plumber(config.plumber))
      .pipe($.newer(config.dist.imageDir))
      .pipe($.imagemin(config.imagemin))
      .pipe(gulp.dest(config.dist.imageDir))
      .on('end', cb);
  });

  gulp.task('test', ['index'], function() {
    if (isPluginEnabled('karma'))
      testRunner.karma();
  });

  gulp.task('testContinuous', ['index'], function() {
    if (isPluginEnabled('karma'))
      testRunner.karmaWatch();
  });

  gulp.task('e2e', ['index'], function() {
    if (isPluginEnabled('e2e'))
      testRunner.casper(path.join(config.src.specDir, config.src.e2eDir));
  });

  gulp.task('default', ['lrServer', 'index', 'testContinuous'], function() {
    if (!isPluginEnabled('watch')) { return; }

    // watchify has its own watcher
    bundler.on('update', function () {
      cleanFolders['scripts'] = false;
      gulp.start('index');
    });

    gulp.watch(path.join(config.src.styleDir, config.src.styleFiles), ['index'])
      .on('change', function() {
        cleanFolders['styles'] = false;
      });

    gulp.watch([
      path.join(config.src.markupDir, config.src.markupFiles),
      path.join(config.src.specDir, config.src.specFiles),
      path.join(config.src.imageDir, config.src.imageFiles)
    ], ['index']);

    if (!isPluginEnabled('livereload')) { return; }
    gulp.watch(path.join(config.dist.markupDir, config.dist.markupFiles), function(file) {
      lrServer.changed(file.path);
      console.log(file.path);
    });

    if (!isPluginEnabled('rename')) {
      // markup is not changed when rename is disabled, we can livereload
      gulp.watch([
        path.join(config.dist.scriptDir, config.dist.scriptFiles),
        path.join(config.dist.styleDir, config.dist.styleFiles)
      ], function(file) {
        lrServer.changed(file.path);
        console.log(file.path);
      });
    }
  });
};
