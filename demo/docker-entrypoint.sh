#!/bin/sh
envsubst '${API_BASE_URL}' < /etc/nginx/templates/nginx.conf.template > /etc/nginx/conf.d/default.conf
cp /usr/share/nginx/html/env.js.template /usr/share/nginx/html/env.js
exec nginx -g 'daemon off;'
