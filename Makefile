pypi: dist
	twine upload dist/*
	
dist:
	-rm dist/*
	python setup.py sdist bdist_wheel

clean:
	rm -rf *.egg-info build dist