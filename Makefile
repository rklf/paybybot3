pypi: clean dist
	twine upload dist/*
	
dist:
	python setup.py sdist bdist_wheel

clean:
	rm -rf *.egg-info build dist