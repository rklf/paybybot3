FROM python:3.11-alpine
WORKDIR /app
RUN apt-get update && apt-get install -y git
RUN git clone https://github.com/HamletDuFromage/paybybot3 .
RUN pip install .