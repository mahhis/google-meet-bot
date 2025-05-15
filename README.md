# Google Meet Bot

## Description

This bot helps to get a link to google meet in 2 clicks, since calls in telegram work poorly this will help to solve the problem

## Live Demo

The bot is currently running and can be tested. You can interact with the bot by visiting the following link:  
[Try the Search Lead Bot](https://t.me/givemegooglemeetbot)

## Installation

To install and run the bot, follow these steps:

1. Clone the repository:

    ```bash
    git clone https://github.com/mahhis/google-meet-bot.git
    ```

2. Navigate to the project folder:

    ```bash
    cd google-meet-bot
    ```

3. Launch the [mongo database](https://www.mongodb.com/) locally

4. Create a `.env` file and add the necessary environment variables. Example at `.env.example`.

5. Install dependencies using Yarn:

    ```bash
    yarn install
    ```
6. To start the bot, run the following command::

    ```bash
    yarn start
    ```    

## Environment variables

- `TOKEN` — Telegram bot token
- `MONGO`— URL of the mongo database

- `GOOGLE_CLIENT_ID` - Go to https://console.cloud.google.com and get it 
- `GOOGLE_SECRET_KEY` - Go to https://console.cloud.google.com and get it 

- `GOOGLE_ACCESS_TOKEN` and  `GOOGLE_ACCESS_TOKEN` - Required values ​​for authorization of the account from which the link will be generated

    ```bash
    node src/helpers/google-auth.js
    ```   
   you will receive a link for authorization in the console. After that, tokens will be sent to the address you specified in the Google console project 
  
     






