FROM php:8.2-fpm

RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    git \
    unzip \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_16.x | bash - \
    && apt-get update \
    && apt-get install -y nodejs \
    && npm install -g yarn

WORKDIR /var/www

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile

COPY . .

RUN yarn build

EXPOSE 8080

CMD ["php", "-S", "0.0.0.0:8080", "-t", "www"]