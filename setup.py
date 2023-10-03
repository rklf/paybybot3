#!/usr/bin/env python3

import os
from setuptools import setup


def read(fname):
    return open(os.path.join(os.path.dirname(__file__), fname)).read()


setup(
    name="paybybot3",
    version="0.1.0",
    author="rklf but originally created by Louis Abraham (louisabraham)",
    license="MIT",
    author_email="louis.abraham@yahoo.fr",
    description="CLI interface to https://www.paybyphone.fr/",
    long_description=read("README.md"),
    long_description_content_type="text/markdown",
    url="https://github.com/rklf/paybybot3",
    packages=["paybybot3"],
    install_requires=["pyyaml", "requests", "click", "apprise"],
    python_requires=">=3.6",
    entry_points={"console_scripts": ["paybybot3 = paybybot3.__main__:cli"]},
    classifiers=["Topic :: Utilities"],
)
