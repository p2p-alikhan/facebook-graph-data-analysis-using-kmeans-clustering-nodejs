// Initializing dependencies
var request = require('request');
var util = require('util');
var bbPromise = require('bluebird');
var lodash = require('lodash');
var json2csv = require('json2csv');
var fs = require('fs');
var kmeans = require('node-kmeans');
var jsonfile = require('jsonfile');

// Initializing config params
var Config = {
  app_id: "your_app_id",
  app_secret: "your_app_secret",
  extended_token: "your_extended_token",
  access_token: "your_app_id|your_app_secret"  
};

// Responsible for fetching 10 facebook graph search results, Wrapped by promised pattern
function facebookGeneralSearch(term,type) {
	return new bbPromise(function(resolve, reject) {	
		request('https://graph.facebook.com/search?q='+term+'&type='+type+'&limit=10&access_token='+Config.access_token, { json: true}, function (error, response, body) {
		if(error){reject(error)}
		resolve(body);
		})
	})
}

// Responsible for fetching facebook page fans count, Wrapped by promised pattern
var list = [];
function getFacebookPageFans(page_id) {	
	return new bbPromise(function(resolve, reject) {		
		request("https://graph.facebook.com/"+page_id+"/?fields=name,fan_count&access_token="+Config.access_token, { json: true}, function (error, response, body) {
		if(error){reject(error)}		
		list.push(body);
		resolve(list);
		});
	})
}

// Responsible for fetching 10 facebook page posts, Wrapped by promised pattern
var posts_list = [];	
function getFacebookPagePosts(page_id) {	
	return new bbPromise(function(resolve, reject) {		
		request("https://graph.facebook.com/v2.6/"+page_id+"/posts/?fields=message,link,permalink_url,created_time,type,name,id,comments.limit(0).summary(true),shares,likes.limit(0).summary(true),reactions.limit(0).summary(true)&limit=10&access_token="+Config.access_token, { json: true}, function (error, response, body) {
		if(error){reject(error)}		
		posts_list.push(body.data);
		resolve(posts_list);
		});
	})
}

// Run facebook search with term digital marketing for finding top pages with highest fan count 
facebookGeneralSearch('"digital marketing"','page').then(function(result) {
				 
	var page_ids = lodash.map(result['data'], 'id');
	
	// Get fans count against each page
	bbPromise.map(page_ids, getFacebookPageFans, { concurrency:2 }).then(function() {		
		// sort dataset by reverse count in desc order
		return lodash.chain(list).sortBy('fan_count').reverse().value();			
	}).then(function(list){
	   
	   var page_ids = lodash.map(list, 'id');			
	   // Get post against each page
	   bbPromise.map(page_ids, getFacebookPagePosts, { concurrency:2 }).then(function() {
	   
			// combine all nested arrays into one			
			var output = lodash.flattenDeep(posts_list); 			
			var cnt = -1;
			var result = lodash.map(output,function(post) {
				// fb post id format >> page_id_post_id
				var tmp_id = post['id'].split("_");
				var page_obj = lodash.find(list, {id: tmp_id[0]});				
				cnt += 1;
				return { 
					sid: cnt,
					id: post.id,
					page_name: page_obj.name,
					fan_count: page_obj.fan_count,
					message: post.message,
					link: post.link,
					likes: post.likes.summary.total_count,
					comments: post.comments.summary.total_count,
					reactions: post.reactions.summary.total_count,
					total: post.likes.summary.total_count + post.comments.summary.total_count + post.reactions.summary.total_count			
				};				
			});		
			
			// Save data in csv format for later analysis
			var fields = ['id', 'page_name', 'fan_count','message','link','likes','comments','reactions','total'];
			var csv = json2csv({ data: result, fields: fields }); 
			fs.writeFile('fb-posts-data.csv', csv, function(err) {
			  if(err){console.log(err)};
			  console.log('fb-posts-data.csv file saved for detail analysis');
			});			
			
			// Applying kmeans clustering here on likes,comments,reactions
			var dataset = new Array();
			for (let i = 0 ; i < result.length ; i++) {
			  dataset[i] = [result[i]['likes'],result[i]['comments'],result[i]['reactions']];
			}			
			kmeans.clusterize(dataset, {k:10}, (err,res) => {
				if (err) {console.error(err)};
				var data = {};
				data.fbresult = result;
				data.kmeans_centroids = lodash.map(res, 'centroid');
				data.kmeans_result = res;
							
                /*							
				jsonfile.writeFile('data.json', data, {spaces: 2}, function(err) {
					if(err){console.log(err)};
					console.log('data.json file saved');
				});
				*/
								
				fs.writeFile('kmeans-analysis.json', util.inspect(data,{showHidden: false, depth: null}), 'utf-8', function(err) {
					if(err){console.log(err)};
					console.log('kmeans-analysis-results.json file saved');
				});
				
			});			
			
		})
	   
	});
	
});
