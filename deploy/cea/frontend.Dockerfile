FROM nginx:1.28-alpine
COPY frontend/dist/ /usr/share/nginx/html/
COPY deploy/cea/nginx.conf /etc/nginx/conf.d/default.conf
