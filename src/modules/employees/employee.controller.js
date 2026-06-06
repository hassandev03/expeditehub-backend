const bcrypt = require('bcrypt');
const { validationResult } = require('express-validator');
const Employee = require('./employee.model');

async function createEmployee(httpRequest, httpResponse, nextMiddleware) {
  const validationErrors = validationResult(httpRequest);
  if (!validationErrors.isEmpty()) {
    return httpResponse.status(400).json({ errors: validationErrors.array() });
  }

  try {
    const { fullName, email, password, role } = httpRequest.body;

    const existingEmployeeWithEmail = await Employee.findOne({
      tenantId: httpRequest.tenantId,
      email
    });
    if (existingEmployeeWithEmail) {
      return httpResponse.status(409).json({
        message: 'An employee with this email already exists in this restaurant'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const savedEmployee = await new Employee({
      tenantId: httpRequest.tenantId,
      fullName,
      email,
      password: hashedPassword,
      role,
      isActive: true
    }).save();

    // Remove password from the response — toObject() makes the doc plain JS
    const employeeResponseObject = savedEmployee.toObject();
    delete employeeResponseObject.password;

    return httpResponse.status(201).json({ employee: employeeResponseObject });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function listEmployees(httpRequest, httpResponse, nextMiddleware) {
  try {
    const queryFilter = { tenantId: httpRequest.tenantId };

    const validEmployeeRoles = ['admin', 'chef', 'cashier'];
    if (httpRequest.query.role && validEmployeeRoles.includes(httpRequest.query.role)) {
      queryFilter.role = httpRequest.query.role;
    }

    const foundEmployees = await Employee.find(queryFilter).select('-password');

    return httpResponse.status(200).json({ employees: foundEmployees });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function getEmployee(httpRequest, httpResponse, nextMiddleware) {
  try {
    const targetEmployeeIdentifier = httpRequest.params.id;

    const foundEmployee = await Employee.findOne({
      _id: targetEmployeeIdentifier,
      tenantId: httpRequest.tenantId
    }).select('-password');

    if (!foundEmployee) {
      return httpResponse.status(404).json({ message: 'Employee not found' });
    }

    return httpResponse.status(200).json({ employee: foundEmployee });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function updateEmployee(httpRequest, httpResponse, nextMiddleware) {
  const validationErrors = validationResult(httpRequest);
  if (!validationErrors.isEmpty()) {
    return httpResponse.status(400).json({ errors: validationErrors.array() });
  }

  try {
    const targetEmployeeIdentifier = httpRequest.params.id;

    const foundEmployee = await Employee.findOne({
      _id: targetEmployeeIdentifier,
      tenantId: httpRequest.tenantId
    });

    if (!foundEmployee) {
      return httpResponse.status(404).json({ message: 'Employee not found' });
    }

    if (httpRequest.body.fullName !== undefined) {
      foundEmployee.fullName = httpRequest.body.fullName;
    }
    if (httpRequest.body.role !== undefined) {
      foundEmployee.role = httpRequest.body.role;
    }

    const savedEmployee = await foundEmployee.save();
    const employeeResponseObject = savedEmployee.toObject();
    delete employeeResponseObject.password;

    return httpResponse.status(200).json({ employee: employeeResponseObject });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

async function deactivateEmployee(httpRequest, httpResponse, nextMiddleware) {
  try {
    const targetEmployeeIdentifier = httpRequest.params.id;

    // Prevent self-deactivation (req.user._id is the sub claim — a string from JWT)
    if (targetEmployeeIdentifier === httpRequest.user._id.toString()) {
      return httpResponse.status(400).json({ message: 'You cannot deactivate your own account' });
    }

    const foundEmployee = await Employee.findOne({
      _id: targetEmployeeIdentifier,
      tenantId: httpRequest.tenantId
    });

    if (!foundEmployee) {
      return httpResponse.status(404).json({ message: 'Employee not found' });
    }

    foundEmployee.isActive = false;
    await foundEmployee.save();

    return httpResponse.status(200).json({ message: 'Employee deactivated' });
  } catch (unexpectedError) {
    nextMiddleware(unexpectedError);
  }
}

module.exports = {
  createEmployee,
  listEmployees,
  getEmployee,
  updateEmployee,
  deactivateEmployee
};
