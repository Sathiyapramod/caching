#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();
import * as http from "http";
import * as url from "url";
import yargs from "yargs/yargs";

const argv = yargs(process.argv.slice(2))
    .options({
        port: {
            alias: "p",
            type: "number",
            description: "Port for the caching proxy server",
            default: 3000,
        },
        target: {
            alias: "t",
            type: "string",
            description: "Target server to forward requests to",
        },
        clearCache: {
            alias: "c",
            type: "boolean",
            description: "Clear all cached responses on start",
            default: false,
        },
    })
    .parse();

const { target, port, clearCache } = argv as { target: string; port: number; clearCache: boolean };

// simple in-memory caching
const cache: Record<
    string,
    {
        data: Buffer;
        headers: http.IncomingHttpHeaders;
    }
> = {};

if (clearCache) {
    console.log("Clearing all cached responses...");
    for (const key in cache) {
        delete cache[key];
    }
    console.log("Cache cleared successfully.");
}

// initiating the server
const server = http.createServer((req, res) => {
    const reqUrl = url.parse(req.url || "", true);
    const cacheKey = reqUrl.href;

    if (cache[cacheKey]) {
        console.log(`Cache hit for ${cacheKey}`);
        const cachedResponse = cache[cacheKey];
        res.writeHead(200, {
            ...cachedResponse.headers,
            "X-Cache": "HIT",
        });
        res.end(cachedResponse.data);
        return;
    }

    console.log(cache);

    console.log(`Cache miss for ${cacheKey}. Forwarding request to ${target}${reqUrl.path}`);

    // Forward the request to the target server
    const targetUrl = new URL(target);
    const options: http.RequestOptions = {
        hostname: targetUrl.hostname,
        port: reqUrl.port || 80,
        path: targetUrl.pathname,
        method: req.method,
        headers: { ...req.headers, host: targetUrl.hostname },
    };

    //creating the request
    const proxyRequest = http.request(options, (proxyResponse) => {
        let body: Buffer[] = [];

        // Collect response data
        //Listens for the data event,
        //which fires every time a chunk of the response arrives from the target server.
        proxyResponse.on("data", (chunk) => {
            // add chunk to the body
            body.push(chunk);
            // by the end, all chunks will be collected inside body array
        });

        proxyResponse.on("end", () => {
            // combining all the chunks of the body into a single buffer
            const responseData = Buffer.concat(body);

            // Caching the response
            // data -> for storing Buffer
            // headers -> for storing headers of the response
            cache[cacheKey] = { data: responseData, headers: proxyResponse.headers };
            // writing the response status code & headers
            res.writeHead(proxyResponse.statusCode || 500, {
                ...proxyResponse.headers,
                "X-Cache": "MISS",
            });
            // ends the response with response data
            res.end(responseData);
        });

        // Handle proxy response errors
        proxyResponse.on("error", (err) => {
            console.error(`Error in proxy response: ${err.message}`);
            res.writeHead(500);
            res.end("Internal Server Error");
        });
    });

    // Handle errors
    proxyRequest.on("error", (err) => {
        console.error(`Error forwarding request: ${err.message}`);
        res.writeHead(500);
        res.end("Internal Server Error");
    });

    // Pipe the incoming client request to the proxy request
    req.pipe(proxyRequest);
});

server.listen(port, () => {
    console.log(`Caching proxy server is running on http://localhost:${port}`);
    console.log(`Forwarding requests to ${target}`);
});
