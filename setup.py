#!/usr/bin/env python3

import os
from setuptools import setup


def read(fname):
    return open(os.path.join(os.path.dirname(__file__), fname)).read()


setup(
    name="paybybot2",
    version="0.0.1",
    author="Louis Abraham",
    license="MIT",
    author_email="louis.abraham@yahoo.fr",
    description="CLI interface to https://www.paybyphone.fr/",
    long_description=read("README.md"),
    long_description_content_type="text/markdown",
    url="https://github.com/louisabraham/paybybot2",
    packages=["paybybot2"],
    install_requires=["pyyaml", "requests", "click"],
    python_requires=">=3.6",
    entry_points={"console_scripts": ["paybybot2 = paybybot2.__main__:cli"]},
    classifiers=["Topic :: Utilities", "Topic :: Security :: Cryptography"],
)
