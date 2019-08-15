FROM uber/web-base-image:10.15.3

WORKDIR /probot-app-monorepo-sync
COPY . /probot-app-monorepo-sync/
RUN yarn
