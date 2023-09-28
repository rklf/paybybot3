FROM python:3.11-alpine
WORKDIR /app
RUN apk update
RUN apk add git
RUN git clone https://github.com/HamletDuFromage/paybybot3 .
RUN pip install .