
libRETS
=======

A driver for RETS servers as specified by the RESO standards group.

### Operation

The libRETS driver is designed to be called from other programs.

The **Setup** section provides a step-by-step guide getting the server installed.  Please use information outlined in the **Configuration** section to create the configuration file.

### Setup

The following procedure should be followed to setup the driver:

+ Install server using NPM:

 ```shell
  npm install libRETS
 ```
 
### Configuration

A text configuration file should be located in the root directory of your project.  The default name of the file is "service.conf", but this name can be overriden when calling the resoServer() method.  A sample of the configuration file called "service.conf" can be found in the samples directory of this distribution.

+ RETS Service (data supplier parameters)

 SERVER\_DOMAIN: The dns name of the computer that will be running the RESO API Server.  If not supplied, the IP Address of the computer will be used.  

 SERVER\_NAME: The name to display in the console at startup.  Useful for private labelling.

 SERVER\_PATH: The path of the RESO API service.

 SERVER\_PORT: The port that the RESO API Server will be listening on.

+ Data Processing 

 LOG\_ENTRY: A boolean value that indicates whether a console log message is generated each time a request is processed.  This produces more output at the console, but allerts you when there is activity. Defaults ot "false".

+ Authentication 

 AUTH\_REALM: The text to use for realm if using Digest Authentication. If this parameter is not included, the realm will default to the string in the SERVER\_NAME parameter. This value is only required if the AUTH\_TYPE is "Digest". 
  
 AUTH\_TYPE: The type of authentication supported by the RESO API Server.  Valid values are "Basic" and "Digest".

 AUTH\_SERVER\_URL: The url of the authentication server that will be used to pass a user name and return a password.

### License

>The MIT License (MIT)
>
>Copyright (c) 2014 National Association of REALTORS
>
>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
:
>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

